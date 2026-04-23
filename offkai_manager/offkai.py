from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import discord
from discord import IntegrationType, InteractionContextType, Option, OptionChoice
from discord.ext import commands, tasks

from offkai_manager.nocodb_repo import OffkaiNocoDbRepo

log = logging.getLogger(__name__)


# py-cord / discord.py compatibility (stubs sometimes differ)
_TextInput = getattr(discord.ui, "TextInput", getattr(discord.ui, "InputText"))
_TextStyle = getattr(discord, "TextStyle", None)
if _TextStyle is not None:
    _PARAGRAPH_STYLE = _TextStyle.paragraph
else:
    _PARAGRAPH_STYLE = discord.InputTextStyle.long

STATUS_CONFIRMED = "confirmed"
STATUS_WAITLIST = "waitlist"
STATUS_CANCELLED = "cancelled"
HAS_PAID_ROLE_SYNC_INTERVAL_MINUTES = 5


def _parse_role_id(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _ensure_manage_guild(ctx: discord.ApplicationContext) -> bool:
    guild = ctx.guild
    member = ctx.author
    if guild is None or not isinstance(member, discord.Member):
        return False
    # 「サーバー管理者のみ」= Administrator 権限(またはサーバーオーナー)に限定。
    return bool(member.id == guild.owner_id or member.guild_permissions.administrator)


_PANEL_CONTENT_CACHE: Optional[dict[str, Any]] = None


def _load_panel_content() -> dict[str, Any]:
    """Load the registration panel text from a JSON file.

    We intentionally avoid taking long multi-line text via slash command arguments.
    """
    global _PANEL_CONTENT_CACHE
    if _PANEL_CONTENT_CACHE is not None:
        return _PANEL_CONTENT_CACHE

    path = Path(__file__).resolve().parent.parent / "data" / "offkai_panel_content.json"
    raw = path.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"panel content JSON must be an object: {path}")
    _PANEL_CONTENT_CACHE = parsed
    return _PANEL_CONTENT_CACHE


def _build_registration_panel_embeds_for(
    *,
    lang: str,
    override_title: Optional[str] = None,
) -> list[discord.Embed]:
    """Build embeds for a single language.

    - lang: 'ja' or 'en'
    """
    content = _load_panel_content()
    block = content.get(lang)
    if not isinstance(block, dict):
        raise RuntimeError(f"panel content missing language block: lang={lang!r}")

    # New format only: store embed payloads directly (compatible with discord.Embed.from_dict()).
    # One message, multiple embeds (split by section).
    embeds_payload = block.get("embeds")
    if not isinstance(embeds_payload, list) or not embeds_payload:
        raise RuntimeError(
            f"panel content missing 'embeds' payload list for lang={lang!r} (data/offkai_panel_content.json)"
        )

    embeds: list[discord.Embed] = []
    for idx, payload in enumerate(embeds_payload):
        if not isinstance(payload, dict):
            raise RuntimeError(
                f"panel content embeds[{idx}] must be an object for lang={lang!r} (data/offkai_panel_content.json)"
            )
        try:
            e = discord.Embed.from_dict(payload)
        except Exception as ex:
            log.exception(
                "Failed to build Embed from panel content JSON (lang=%s, idx=%s)",
                lang,
                idx,
            )
            raise RuntimeError(
                f"invalid embed payload for lang={lang!r} embeds[{idx}] (data/offkai_panel_content.json)"
            ) from ex
        embeds.append(e)

    if override_title and embeds:
        embeds[0].title = override_title
    return embeds


async def _fetch_event(con: Any, event_id: int):
    raise RuntimeError("_fetch_event is PostgreSQL-only and should not be used")


def _nc_fields(record: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not record:
        return {}
    fields = record.get("fields")
    return fields if isinstance(fields, dict) else {}


def _nc_int(value: Any, *, default: int | None = None) -> int | None:
    if value is None:
        return default
    try:
        # NocoDB sometimes returns numbers as float/decimal.
        return int(value)
    except Exception:
        try:
            return int(str(value))
        except Exception:
            return default


def _registration_member_id(fields: dict[str, Any]) -> Optional[int]:
    member_id = _nc_int(fields.get("member_id"))
    if member_id is not None:
        return member_id

    linked = fields.get("member")
    if isinstance(linked, list) and linked and isinstance(linked[0], dict):
        return _nc_int(linked[0].get("id"))
    return None


def _locale_code(value: Any) -> str:
    if value is None:
        return ""
    try:
        return str(value)
    except Exception:
        return ""


def _is_ja_locale(value: Any) -> bool:
    return _locale_code(value).lower().startswith("ja")


def _msg(is_ja: bool, ja: str, en: str) -> str:
    return ja if is_ja else en


def _interaction_ids(
    interaction: discord.Interaction,
) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
    """Return (interaction_id, guild_id, channel_id, message_id, user_id)."""
    interaction_id = getattr(interaction, "id", None)
    guild_id = interaction.guild.id if interaction.guild else None
    channel_id = getattr(getattr(interaction, "channel", None), "id", None)
    message_id = getattr(getattr(interaction, "message", None), "id", None)
    user_id = interaction.user.id if interaction.user else None
    return interaction_id, guild_id, channel_id, message_id, user_id


def _custom_id_from_interaction(interaction: discord.Interaction) -> str:
    # component interactions: interaction.data may contain custom_id
    data = getattr(interaction, "data", None)
    if isinstance(data, dict):
        cid = data.get("custom_id")
        if isinstance(cid, str):
            return cid
    return ""


async def _apply_roles_to_member(
    member: discord.Member,
    *,
    confirmed_role_id: Optional[int],
    waitlist_role_id: Optional[int],
    status: str,
) -> None:
    guild = member.guild
    confirmed_role = (
        guild.get_role(int(confirmed_role_id)) if confirmed_role_id else None
    )
    waitlist_role = guild.get_role(int(waitlist_role_id)) if waitlist_role_id else None

    try:
        to_remove = [
            r for r in (confirmed_role, waitlist_role) if r and r in member.roles
        ]
        if to_remove:
            await member.remove_roles(*to_remove, reason="Sync registration status")

        if status == STATUS_CONFIRMED and confirmed_role:
            await member.add_roles(confirmed_role, reason="Registration confirmed")
        elif status == STATUS_WAITLIST and waitlist_role:
            await member.add_roles(waitlist_role, reason="Registration waitlist")
    except discord.HTTPException:
        log.exception("Failed to sync roles")


async def _apply_roles(
    interaction: discord.Interaction,
    *,
    confirmed_role_id: Optional[int],
    waitlist_role_id: Optional[int],
    status: str,
) -> None:
    guild = interaction.guild
    if guild is None:
        return

    user = interaction.user
    if user is None:
        return

    try:
        if isinstance(user, discord.Member):
            member = user
        else:
            member = await guild.fetch_member(user.id)
    except discord.HTTPException:
        log.exception("Failed to fetch member for role sync")
        return

    await _apply_roles_to_member(
        member,
        confirmed_role_id=confirmed_role_id,
        waitlist_role_id=waitlist_role_id,
        status=status,
    )


async def _respond_ephemeral(
    interaction: discord.Interaction,
    content: str,
    *,
    allowed_mentions: Optional[discord.AllowedMentions] = None,
) -> None:
    if interaction.response.is_done():
        if allowed_mentions is None:
            await interaction.followup.send(content, ephemeral=True)
        else:
            await interaction.followup.send(
                content,
                ephemeral=True,
                allowed_mentions=allowed_mentions,
            )
    else:
        if allowed_mentions is None:
            await interaction.response.send_message(content, ephemeral=True)
        else:
            await interaction.response.send_message(
                content,
                ephemeral=True,
                allowed_mentions=allowed_mentions,
            )


def _allowed_mentions_all() -> discord.AllowedMentions:
    """Return an AllowedMentions instance that allows all mentions.

    Some py-cord/discord.py stubs differ on whether AllowedMentions.all is a
    callable or a prebuilt instance.
    """

    am = discord.AllowedMentions
    maybe = getattr(am, "all", None)
    if callable(maybe):
        return maybe()  # type: ignore[misc]
    if isinstance(maybe, discord.AllowedMentions):
        return maybe
    return discord.AllowedMentions(
        everyone=True,
        users=True,
        roles=True,
        replied_user=True,
    )


def _format_current_ticket_roles_mention_list(
    *,
    guild: discord.Guild,
    member: discord.Member,
    is_ja: bool,
) -> tuple[str, list[discord.Role]]:
    """Return (formatted_text, roles) for ticket/day roles currently held by member.

    The formatted text is intended to be appended to an ephemeral response.
    """

    held: list[discord.Role] = []
    for spec in _iter_ticket_role_specs():
        r = _find_role_by_candidates(guild, spec.role_name_candidates)
        if r is not None and r in getattr(member, "roles", []):
            held.append(r)

    if not held:
        return _msg(
            is_ja, "現在ついているチケット系ロール: なし", "Current ticket roles: none"
        ), []

    mentions = " ".join(r.mention for r in held)
    prefix = _msg(is_ja, "現在ついているチケット系ロール", "Current ticket roles")
    return f"{prefix}: {mentions}", held


def _is_image_attachment(att: discord.Attachment) -> bool:
    """Best-effort check whether the attachment is an image.

    Discord sets content_type for most uploads, but it may be None.
    """

    ct = getattr(att, "content_type", None)
    if isinstance(ct, str) and ct.lower().startswith("image/"):
        return True

    name = (getattr(att, "filename", None) or "").lower()
    for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        if name.endswith(ext):
            return True
    return False


class RegistrationModal(discord.ui.Modal):
    def __init__(
        self,
        *,
        view: "RegistrationView",
        locale_code: Optional[str],
        is_edit: bool = False,
    ) -> None:
        is_ja = bool(locale_code and locale_code.startswith("ja"))
        title = "登録情報編集" if is_edit else "参加登録"
        if not is_ja:
            title = "Edit Registration" if is_edit else "Registration"
        super().__init__(title=title)
        self._view = view
        self._locale_code = locale_code
        self._is_edit = is_edit

        self.twitter = _TextInput(
            label=("X (Twitter) ID" if is_ja else "X handle"),
            placeholder=("例：@tanigox" if is_ja else "e.g. @tanigox"),
            required=True,
            max_length=64,
        )

        self.residence = _TextInput(
            label=("居住地" if is_ja else "Residence"),
            placeholder=("例：日本" if is_ja else "e.g. Japan"),
            required=True,
            max_length=64,
        )
        self.requests = _TextInput(
            label=("質問・要望" if is_ja else "Requests"),
            placeholder=(
                "例：豚肉が食べられません" if is_ja else "e.g. I don't eat pork."
            ),
            required=False,
            style=_PARAGRAPH_STYLE,
            max_length=400,
        )
        self.add_item(self.twitter)
        self.add_item(self.residence)
        self.add_item(self.requests)

    async def _submit_impl(self, interaction: discord.Interaction) -> None:
        """Handle modal submission.

        py-cord has historically differed on whether `on_submit` or `callback` is used.
        We funnel both into this method to be safe.
        """
        guild_id = interaction.guild.id if interaction.guild else None
        user_id = interaction.user.id if interaction.user else None
        log.info(
            "RegistrationModal.submit received guild_id=%s user_id=%s event_id=%s panel_id=%s is_edit=%s",
            guild_id,
            user_id,
            getattr(self._view.panel, "event_id", None),
            getattr(self._view.panel, "panel_id", None),
            self._is_edit,
        )
        try:
            await self._view.handle_registration_submit(
                interaction,
                twitter=self.twitter.value,
                residence=self.residence.value,
                requests=self.requests.value,
                locale_code=self._locale_code,
                is_edit=self._is_edit,
            )
        except Exception as e:
            # py-cordの既定ログだけだと拾えないケースがあるので、確実にログへ。
            await self.on_error(e, interaction)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self._submit_impl(interaction)

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        # Some py-cord versions use callback() for Modals.
        await self._submit_impl(interaction)

    async def on_error(
        self,
        error: Exception,
        interaction: discord.Interaction,
    ) -> None:
        err_id = secrets.token_hex(4)
        guild_id = interaction.guild.id if interaction.guild else None
        user_id = interaction.user.id if interaction.user else None
        event_id = getattr(self._view.panel, "event_id", None)
        panel_id = getattr(self._view.panel, "panel_id", None)

        log.error(
            "RegistrationModal failed error_id=%s guild_id=%s user_id=%s event_id=%s panel_id=%s is_edit=%s",
            err_id,
            guild_id,
            user_id,
            event_id,
            panel_id,
            self._is_edit,
            exc_info=error,
        )

        # 可能ならユーザーにもエラーIDを返して、運営がログと突き合わせられるようにする。
        is_ja = _is_ja_locale(getattr(interaction, "locale", None))
        msg = _msg(
            is_ja,
            f"処理でエラーが発生しました。運営に連絡してください (error_id={err_id})",
            f"Operation failed. Please contact an organizer. (error_id={err_id})",
        )
        try:
            await _respond_ephemeral(interaction, msg)
        except Exception:
            # 既に応答済み/ネットワークエラー等で返信できない場合でも、ログは残っている。
            pass


class SayModal(discord.ui.Modal):
    def __init__(
        self,
        *,
        target_channel_id: int,
        locale_code: Optional[str],
        attachments: Iterable[discord.Attachment] = (),
    ) -> None:
        is_ja = bool(locale_code and locale_code.startswith("ja"))
        super().__init__(title=("Botとして送信" if is_ja else "Send as Bot"))

        self._target_channel_id = int(target_channel_id)
        self._locale_code = locale_code
        self._attachments = tuple(attachments)

        self.message = _TextInput(
            label=("送信内容" if is_ja else "Message"),
            placeholder=(
                "ここに本文を入力（改行OK）\n空欄で画像のみ送信"
                if is_ja
                else "Type your message here (newlines OK)\nLeave blank to send images only."
            ),
            required=False,
            style=_PARAGRAPH_STYLE,
            max_length=2000,
        )
        self.add_item(self.message)

    async def _submit_impl(self, interaction: discord.Interaction) -> None:
        err_id = secrets.token_hex(4)
        interaction_id, guild_id, channel_id, message_id, user_id = _interaction_ids(
            interaction
        )
        log.info(
            "say_modal submit start error_id=%s interaction_id=%s guild_id=%s channel_id=%s message_id=%s user_id=%s target_channel_id=%s",
            err_id,
            interaction_id,
            guild_id,
            channel_id,
            message_id,
            user_id,
            int(self._target_channel_id),
        )

        is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))

        try:
            if interaction.guild is None:
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ利用できます。",
                        "This can only be used in a server.",
                    ),
                )
                return

            content = (self.message.value or "").strip()
            if not content and not self._attachments:
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "送信内容を入力するか、画像を添付してください。",
                        "Please enter a message or attach images.",
                    ),
                )
                return

            # Resolve target channel (prefer cache; fall back to fetch).
            ch = interaction.guild.get_channel(int(self._target_channel_id))
            if ch is None:
                try:
                    ch = await interaction.guild.fetch_channel(
                        int(self._target_channel_id)
                    )
                except discord.HTTPException:
                    ch = None

            if ch is None or not isinstance(ch, discord.abc.Messageable):
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "送信先チャンネルが見つかりません。",
                        "Target channel was not found.",
                    ),
                )
                return

            files: list[discord.File] = []
            for att in self._attachments:
                if not _is_image_attachment(att):
                    await _respond_ephemeral(
                        interaction,
                        _msg(
                            is_ja_client,
                            "画像ファイルを指定してください。",
                            "Please provide image files.",
                        ),
                    )
                    return
                files.append(await att.to_file(use_cached=True))

            # /offkai say は運営(admin)限定のため、メンションは常に許可する。
            if files:
                await ch.send(
                    content=content or None,
                    files=files,
                    allowed_mentions=_allowed_mentions_all(),
                )
            else:
                await ch.send(content, allowed_mentions=_allowed_mentions_all())

            await _respond_ephemeral(
                interaction,
                _msg(is_ja_client, "送信しました。", "Sent."),
            )
            log.info(
                "say_modal submit success error_id=%s guild_id=%s user_id=%s target_channel_id=%s",
                err_id,
                interaction.guild.id,
                interaction.user.id if interaction.user else None,
                int(self._target_channel_id),
            )
        except discord.Forbidden:
            await _respond_ephemeral(
                interaction,
                _msg(
                    is_ja_client,
                    "権限不足で送信できません（Botの権限/チャンネル設定を確認してください）。",
                    "Permission denied (please check the bot permissions / channel settings).",
                ),
            )
        except Exception as e:
            log.exception(
                "say_modal submit failed error_id=%s guild_id=%s user_id=%s target_channel_id=%s",
                err_id,
                guild_id,
                user_id,
                int(self._target_channel_id),
            )
            try:
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        f"送信に失敗しました。運営に連絡してください (error_id={err_id})",
                        f"Failed to send. Please contact an organizer. (error_id={err_id})",
                    ),
                )
            except Exception:
                pass
            await self.on_error(e, interaction)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self._submit_impl(interaction)

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        await self._submit_impl(interaction)

    async def on_error(
        self, error: Exception, interaction: discord.Interaction
    ) -> None:
        log.error(
            "SayModal on_error guild_id=%s user_id=%s target_channel_id=%s",
            interaction.guild.id if interaction.guild else None,
            interaction.user.id if interaction.user else None,
            int(self._target_channel_id),
            exc_info=error,
        )


@dataclass(frozen=True)
class PanelConfig:
    panel_id: int
    event_id: int
    custom_id_prefix: str
    lang: str


def _normalize_lang(value: Optional[str]) -> str:
    v = (value or "").strip().lower()
    return "ja" if v.startswith("ja") else "en" if v.startswith("en") else "ja"


def _registration_button_label(lang: str) -> str:
    # Keep labels short; Discord button label limit is 80 chars.
    return "同意して参加登録" if _normalize_lang(lang) == "ja" else "Agree & Register"


def _registration_custom_id_prefix_for_panel(panel_id: int) -> str:
    """Deterministic custom_id prefix.

    This allows us to reconstruct component custom_id values after a restart
    without storing random tokens in NocoDB.
    """

    # Discord custom_id limit is 100 chars.
    return f"offkai:panel:{int(panel_id)}"


class RegistrationView(discord.ui.View):
    def __init__(
        self,
        *,
        repo: OffkaiNocoDbRepo,
        panel: PanelConfig,
        button_label_register: str,
    ) -> None:
        super().__init__(timeout=None)
        self.repo = repo
        self.panel = panel

        register = discord.ui.Button(
            label=button_label_register,
            style=discord.ButtonStyle.primary,
            custom_id=f"{panel.custom_id_prefix}:register",
        )
        register.callback = self._on_register  # type: ignore[assignment]

        self.add_item(register)

    async def _on_register(self, interaction: discord.Interaction) -> None:
        interaction_id, guild_id, channel_id, message_id, user_id = _interaction_ids(
            interaction
        )
        log.info(
            "register_click interaction_id=%s guild_id=%s channel_id=%s message_id=%s user_id=%s event_id=%s panel_id=%s custom_id=%s locale=%s",
            interaction_id,
            guild_id,
            channel_id,
            message_id,
            user_id,
            getattr(self.panel, "event_id", None),
            getattr(self.panel, "panel_id", None),
            _custom_id_from_interaction(interaction),
            _locale_code(getattr(interaction, "locale", None)),
        )

        # モーダルの言語は「パネルの言語」に固定する。
        locale_code = _normalize_lang(getattr(self.panel, "lang", "ja"))
        is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))

        user = interaction.user
        if interaction.guild is None or user is None:
            await _respond_ephemeral(
                interaction,
                _msg(
                    is_ja_client,
                    "サーバー内でのみ利用できます。",
                    "This can only be used in a server.",
                ),
            )
            return

        try:
            # NocoDB: resolve member record and check existing registration for this event.
            member_rec = await self.repo.get_or_create_member(
                guild_id=interaction.guild.id,
                user_id=user.id,
                display_name=(
                    user.display_name
                    if isinstance(user, discord.Member)
                    else str(user.id)
                ),
                username=str(user.name),
            )
            member_id = _nc_int(member_rec.get("id"))
            if member_id is None:
                log.warning(
                    "register_click failed to resolve member_id guild_id=%s user_id=%s event_id=%s panel_id=%s",
                    guild_id,
                    user_id,
                    getattr(self.panel, "event_id", None),
                    getattr(self.panel, "panel_id", None),
                )
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "内部エラー: member_id を取得できませんでした。",
                        "Internal error: failed to resolve member_id.",
                    ),
                )
                return

            existing = await self.repo.find_registration_for_event(
                event_id=self.panel.event_id,
                member_id=member_id,
            )
            if existing:
                existing_id = _nc_int(existing.get("id"))
                log.info(
                    "register_click already_registered guild_id=%s user_id=%s member_id=%s event_id=%s panel_id=%s registration_id=%s",
                    guild_id,
                    user_id,
                    member_id,
                    getattr(self.panel, "event_id", None),
                    getattr(self.panel, "panel_id", None),
                    existing_id,
                )
                # Show edit modal for existing registration
                existing_fields = _nc_fields(existing)
                modal = RegistrationModal(
                    view=self, locale_code=locale_code, is_edit=True
                )
                modal.twitter.value = str(existing_fields.get("twitter_id") or "")
                modal.residence.value = str(existing_fields.get("residence") or "")
                modal.requests.value = str(existing_fields.get("requests") or "")
                await interaction.response.send_modal(modal)
                return

            await interaction.response.send_modal(
                RegistrationModal(view=self, locale_code=locale_code),
            )
            log.info(
                "register_click modal_shown guild_id=%s user_id=%s member_id=%s event_id=%s panel_id=%s",
                guild_id,
                user_id,
                member_id,
                getattr(self.panel, "event_id", None),
                getattr(self.panel, "panel_id", None),
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "Register button failed error_id=%s guild_id=%s user_id=%s event_id=%s panel_id=%s",
                err_id,
                guild_id,
                user_id,
                getattr(self.panel, "event_id", None),
                getattr(self.panel, "panel_id", None),
            )
            msg = _msg(
                is_ja_client,
                f"登録画面を開けませんでした。運営に連絡してください (error_id={err_id})",
                f"Failed to open registration form. Please contact an organizer. (error_id={err_id})",
            )
            try:
                await _respond_ephemeral(interaction, msg)
            except Exception:
                pass

    async def handle_registration_submit(
        self,
        interaction: discord.Interaction,
        *,
        twitter: str,
        residence: str,
        requests: str,
        locale_code: Optional[str],
        is_edit: bool = False,
    ) -> None:
        err_id = secrets.token_hex(4)
        step = "start"

        interaction_id, guild_id, channel_id, message_id, user_id = _interaction_ids(
            interaction
        )
        log.info(
            "registration_submit start error_id=%s interaction_id=%s guild_id=%s channel_id=%s message_id=%s user_id=%s event_id=%s panel_id=%s locale=%s is_edit=%s",
            err_id,
            interaction_id,
            guild_id,
            channel_id,
            message_id,
            user_id,
            getattr(self.panel, "event_id", None),
            getattr(self.panel, "panel_id", None),
            _locale_code(getattr(interaction, "locale", None)),
            is_edit,
        )

        try:
            is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))
            if interaction.guild is None:
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ利用できます。",
                        "This can only be used in a server.",
                    ),
                )
                return

            user = interaction.user
            if user is None:
                await _respond_ephemeral(
                    interaction,
                    _msg(
                        is_ja_client,
                        "ユーザー情報を取得できませんでした。",
                        "Failed to resolve your user information.",
                    ),
                )
                return

            # 3秒制限回避のため、できるだけ早くACKする。
            if not interaction.response.is_done():
                step = "defer"
                await interaction.response.defer(ephemeral=True)

            step = "validate"

            twitter_value = (twitter or "").strip() or None
            residence_value = (residence or "").strip() or None
            requests_value = (requests or "").strip() or None

            if not twitter_value:
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "X (Twitter) ID は必須です。",
                        "X handle is required.",
                    ),
                    ephemeral=True,
                )
                return

            if not residence_value:
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "居住地は必須です。",
                        "Residence is required.",
                    ),
                    ephemeral=True,
                )
                return

            # Load event
            step = "get_event"
            ev = await self.repo.get_event(self.panel.event_id)
            if not ev:
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "イベント設定が見つかりません。",
                        "Event configuration was not found.",
                    ),
                    ephemeral=True,
                )
                return

            evf = _nc_fields(ev)
            capacity = _nc_int(evf.get("capacity"), default=0) or 0

            log.info(
                "registration_submit event_loaded error_id=%s event_id=%s capacity=%s",
                err_id,
                getattr(self.panel, "event_id", None),
                capacity,
            )

            # Resolve member + existing registration
            step = "resolve_member"
            display_name: str
            if isinstance(user, discord.Member):
                display_name = user.display_name
            else:
                m = await interaction.guild.fetch_member(user.id)
                display_name = m.display_name

            member_rec = await self.repo.get_or_create_member(
                guild_id=interaction.guild.id,
                user_id=user.id,
                display_name=display_name,
                username=str(user.name),
            )
            member_id = _nc_int(member_rec.get("id"))
            if member_id is None:
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "内部エラー: member_id を取得できませんでした。",
                        "Internal error: failed to resolve member_id.",
                    ),
                    ephemeral=True,
                )
                return

            log.info(
                "registration_submit member_resolved error_id=%s guild_id=%s user_id=%s member_id=%s",
                err_id,
                guild_id,
                user_id,
                member_id,
            )

            step = "check_existing"
            existing = await self.repo.find_registration_for_event(
                event_id=self.panel.event_id,
                member_id=member_id,
            )

            if existing and not is_edit:
                # Found existing registration but this is a new submission attempt
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "すでに登録済みです。変更には登録ボタンを再度押してください。",
                        "You are already registered. Press the register button again to edit.",
                    ),
                    ephemeral=True,
                )
                return

            # If this is an edit, use the existing registration ID
            if is_edit:
                if not existing:
                    await interaction.followup.send(
                        _msg(
                            is_ja_client,
                            "登録情報が見つかりません。",
                            "Registration not found.",
                        ),
                        ephemeral=True,
                    )
                    return
                registration_id = _nc_int(existing.get("id"))
                if registration_id is None:
                    await interaction.followup.send(
                        _msg(
                            is_ja_client,
                            "内部エラー: registration_id を取得できませんでした。",
                            "Internal error: failed to resolve registration_id.",
                        ),
                        ephemeral=True,
                    )
                    return
                step = "update_registration"
                existing_fields = _nc_fields(existing)
                is_confirmed = bool(existing_fields.get("is_confirmed"))
                await self.repo.update_registration(
                    registration_id=int(registration_id),
                    fields={
                        "twitter_id": twitter_value,
                        "residence": residence_value,
                        "requests": requests_value,
                    },
                )
                log.info(
                    "registration_submit updated error_id=%s registration_id=%s event_id=%s member_id=%s",
                    err_id,
                    int(registration_id),
                    getattr(self.panel, "event_id", None),
                    member_id,
                )
                # Use existing confirmed status for role sync
                status = STATUS_CONFIRMED if is_confirmed else STATUS_WAITLIST
                await _apply_roles(
                    interaction,
                    confirmed_role_id=_parse_role_id(
                        str(evf.get("participant_role_id"))
                        if evf.get("participant_role_id")
                        else None
                    ),
                    waitlist_role_id=_parse_role_id(
                        str(evf.get("pending_role_id"))
                        if evf.get("pending_role_id")
                        else None
                    ),
                    status=status,
                )
                await interaction.followup.send(
                    "登録情報を更新しました。/ Registration updated.",
                    ephemeral=True,
                )
                log.info(
                    "registration_submit edit_success error_id=%s guild_id=%s user_id=%s event_id=%s member_id=%s registration_id=%s",
                    err_id,
                    guild_id,
                    user_id,
                    getattr(self.panel, "event_id", None),
                    member_id,
                    int(registration_id),
                )
                return

            step = "count_confirmed"
            confirmed_count = await self.repo.count_confirmed_for_event(
                event_id=self.panel.event_id
            )
            if capacity > 0 and int(confirmed_count) >= int(capacity):
                # Full: reject instead of placing on waitlist/pending.
                await interaction.followup.send(
                    _msg(
                        is_ja_client,
                        "定員に達したため受付できませんでした。",
                        "Registration is closed because the event is full.",
                    ),
                    ephemeral=True,
                )
                log.info(
                    "registration_submit rejected_full error_id=%s event_id=%s member_id=%s confirmed_count=%s capacity=%s",
                    err_id,
                    getattr(self.panel, "event_id", None),
                    member_id,
                    int(confirmed_count),
                    int(capacity),
                )
                return

            # Accepted registrations are always confirmed.
            new_is_confirmed = True

            log.info(
                "registration_submit capacity_decision error_id=%s event_id=%s member_id=%s confirmed_count=%s capacity=%s is_confirmed=%s",
                err_id,
                getattr(self.panel, "event_id", None),
                member_id,
                int(confirmed_count),
                int(capacity),
                bool(new_is_confirmed),
            )

            step = "create_registration"
            created_registration_id = await self.repo.create_registration(
                event_id=self.panel.event_id,
                panel_id=self.panel.panel_id,
                member_id=member_id,
                display_name=display_name,
                twitter_id=twitter_value,
                residence=residence_value,
                requests=requests_value,
                is_confirmed=bool(new_is_confirmed),
            )

            log.info(
                "registration_submit created error_id=%s registration_id=%s event_id=%s panel_id=%s member_id=%s is_confirmed=%s",
                err_id,
                int(created_registration_id),
                getattr(self.panel, "event_id", None),
                getattr(self.panel, "panel_id", None),
                member_id,
                bool(new_is_confirmed),
            )

            # Race safety: if lookup filtering is unreliable or multiple submissions happen,
            # ensure there is only one registration per (event, member).
            try:
                step = "dedupe"
                regs = await self.repo.list_registrations_for_event_member(
                    event_id=self.panel.event_id,
                    member_id=member_id,
                    limit=50,
                )
                ids: list[int] = []
                for r in regs:
                    rid = _nc_int(r.get("id"))
                    if rid is not None:
                        ids.append(int(rid))
                if len(ids) >= 2:
                    keep_id = min(ids)
                    delete_ids = [x for x in ids if x != keep_id]

                    log.warning(
                        "registration_submit duplicate_detected error_id=%s event_id=%s member_id=%s ids=%s keep_id=%s delete_ids=%s",
                        err_id,
                        getattr(self.panel, "event_id", None),
                        member_id,
                        ids,
                        keep_id,
                        delete_ids,
                    )

                    for did in delete_ids:
                        try:
                            await self.repo.delete_registration(registration_id=did)
                        except Exception:
                            log.exception(
                                "Failed to delete duplicate registration id=%s event_id=%s member_id=%s",
                                did,
                                self.panel.event_id,
                                member_id,
                            )

                    # If an older registration exists, prefer it and treat this submission as a duplicate.
                    if int(keep_id) != int(created_registration_id):
                        log.info(
                            "registration_submit treated_as_duplicate error_id=%s created_id=%s keep_id=%s event_id=%s member_id=%s",
                            err_id,
                            int(created_registration_id),
                            int(keep_id),
                            getattr(self.panel, "event_id", None),
                            member_id,
                        )
                        await interaction.followup.send(
                            _msg(
                                is_ja_client,
                                "すでに登録済みです。変更・キャンセルは幹事に連絡してください。",
                                "You are already registered. Please contact an organizer for changes/cancellation.",
                            ),
                            ephemeral=True,
                        )
                        return
            except Exception:
                # Best-effort only; don't block the user flow.
                log.exception(
                    "Failed to dedupe registrations event_id=%s member_id=%s",
                    self.panel.event_id,
                    member_id,
                )

            # Apply roles based on confirmed/pending
            step = "apply_roles"
            participant_role_id = evf.get("participant_role_id")
            pending_role_id = evf.get("pending_role_id")
            status = STATUS_CONFIRMED
            await _apply_roles(
                interaction,
                confirmed_role_id=_parse_role_id(
                    str(participant_role_id) if participant_role_id else None
                ),
                waitlist_role_id=_parse_role_id(
                    str(pending_role_id) if pending_role_id else None
                ),
                status=status,
            )

            log.info(
                "registration_submit roles_applied error_id=%s guild_id=%s user_id=%s event_id=%s member_id=%s status=%s participant_role_id=%s pending_role_id=%s",
                err_id,
                guild_id,
                user_id,
                getattr(self.panel, "event_id", None),
                member_id,
                status,
                str(participant_role_id or ""),
                str(pending_role_id or ""),
            )

            # Best-effort audit log to event.log_channel_id
            log_channel_id = _parse_role_id(
                str(evf.get("log_channel_id")) if evf.get("log_channel_id") else None
            )
            if interaction.guild and log_channel_id:
                ch = interaction.guild.get_channel(int(log_channel_id))
                if isinstance(ch, discord.TextChannel):
                    try:
                        await ch.send(
                            f"registration: event_id={self.panel.event_id} panel_id={self.panel.panel_id} user_id={user.id} confirmed={new_is_confirmed} twitter={twitter_value or ''}"
                        )
                    except discord.HTTPException:
                        log.warning(
                            "registration_submit failed to send audit log to channel guild_id=%s channel_id=%s",
                            interaction.guild.id,
                            int(log_channel_id),
                        )

            msg = "参加確定しました / Registered"
            if not participant_role_id and not pending_role_id:
                msg += "\n※イベントのロールが未設定のため、ロール付与は行われません。"
            await interaction.followup.send(msg, ephemeral=True)

            log.info(
                "registration_submit success error_id=%s guild_id=%s user_id=%s event_id=%s panel_id=%s member_id=%s registration_id=%s is_confirmed=%s is_edit=%s",
                err_id,
                guild_id,
                user_id,
                getattr(self.panel, "event_id", None),
                getattr(self.panel, "panel_id", None),
                member_id,
                int(created_registration_id),
                bool(new_is_confirmed),
                is_edit,
            )

        except Exception:
            log.exception(
                "registration_submit failed error_id=%s step=%s interaction_id=%s guild_id=%s channel_id=%s message_id=%s user_id=%s event_id=%s panel_id=%s is_edit=%s",
                err_id,
                step,
                interaction_id,
                guild_id,
                channel_id,
                message_id,
                user_id,
                getattr(self.panel, "event_id", None),
                getattr(self.panel, "panel_id", None),
                is_edit,
            )

            is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))
            msg = _msg(
                is_ja_client,
                f"登録処理でエラーが発生しました。運営に連絡してください (error_id={err_id})",
                f"Registration failed. Please contact an organizer. (error_id={err_id})",
            )
            try:
                await _respond_ephemeral(interaction, msg)
            except Exception:
                pass


@dataclass(frozen=True)
class TicketRoleSpec:
    key: str
    nocodb_value: str
    label_ja: str
    label_en: str
    role_name_candidates: tuple[str, ...]
    row: int


def _iter_ticket_role_specs() -> Iterable[TicketRoleSpec]:
    # 参加登録とは独立した「アンケ/コミュニケーション用」ロール。
    # ロール名はサーバーに合わせて作る前提。候補を複数用意して当てにいく。
    return (
        TicketRoleSpec(
            key="fes_stage1",
            nocodb_value="fes-1",
            label_ja="Fes Stage 1",
            label_en="Fes Stage 1",
            role_name_candidates=(
                "fes. stage 1",
                "fes. stage1",
                "fes stage1",
                "fes stage 1",
                "fes-stage1",
                "fes_stage1",
                "Fes Stage 1",
            ),
            row=0,
        ),
        TicketRoleSpec(
            key="fes_stage2",
            nocodb_value="fes-2",
            label_ja="Fes Stage 2",
            label_en="Fes Stage 2",
            role_name_candidates=(
                "fes. stage 2",
                "fes. stage2",
                "fes stage2",
                "fes stage 2",
                "fes-stage2",
                "fes_stage2",
                "Fes Stage 2",
            ),
            row=0,
        ),
        TicketRoleSpec(
            key="fes_stage3",
            nocodb_value="fes-3",
            label_ja="Fes Stage 3",
            label_en="Fes Stage 3",
            role_name_candidates=(
                "fes. stage 3",
                "fes. stage3",
                "fes stage3",
                "fes stage 3",
                "fes-stage3",
                "fes_stage3",
                "Fes Stage 3",
            ),
            row=0,
        ),
        TicketRoleSpec(
            key="fes_stage4",
            nocodb_value="fes-4",
            label_ja="Fes Stage 4",
            label_en="Fes Stage 4",
            role_name_candidates=(
                "fes. stage 4",
                "fes. stage4",
                "fes stage4",
                "fes stage 4",
                "fes-stage4",
                "fes_stage4",
                "Fes Stage 4",
            ),
            row=0,
        ),
        TicketRoleSpec(
            key="expo_day1",
            nocodb_value="expo-1",
            label_ja="EXPO Day 1",
            label_en="EXPO Day 1",
            role_name_candidates=(
                "EXPO day 1",
                "expo day 1",
                "expo day1",
                "expo-day1",
                "expo_day1",
                "EXPO Day 1",
            ),
            row=1,
        ),
        TicketRoleSpec(
            key="expo_day2",
            nocodb_value="expo-2",
            label_ja="EXPO Day 2",
            label_en="EXPO Day 2",
            role_name_candidates=(
                "EXPO day 2",
                "expo day 2",
                "expo day2",
                "expo-day2",
                "expo_day2",
                "EXPO Day 2",
            ),
            row=1,
        ),
        TicketRoleSpec(
            key="expo_day3",
            nocodb_value="expo-3",
            label_ja="EXPO Day 3",
            label_en="EXPO Day 3",
            role_name_candidates=(
                "EXPO day 3",
                "expo day 3",
                "expo day3",
                "expo-day3",
                "expo_day3",
                "EXPO Day 3",
            ),
            row=1,
        ),
        # All-lost (no ticket) marker. This must be mutually exclusive with other ticket/day roles.
        TicketRoleSpec(
            key="zenloss",
            nocodb_value="zenloss",
            label_ja="zenloss",
            label_en="zenloss",
            role_name_candidates=(
                "zenloss",
                "Zenloss",
                "zen loss",
                "zen-loss",
                "zen_loss",
            ),
            row=2,
        ),
    )


def _find_role_by_candidates(
    guild: discord.Guild, candidates: tuple[str, ...]
) -> Optional[discord.Role]:
    # Prefer exact match first, then case-insensitive.
    for c in candidates:
        r = discord.utils.get(guild.roles, name=c)
        if r is not None:
            return r

    lowered = {c.lower() for c in candidates}
    for r in guild.roles:
        if (r.name or "").lower() in lowered:
            return r
    return None


class TicketRolesView(discord.ui.View):
    """Self-assign roles for ticket status (survey/communication).

    This is intentionally independent from registration.
    """

    def __init__(self, *, repo: Optional[OffkaiNocoDbRepo] = None) -> None:
        super().__init__(timeout=None)
        self._repo = repo

        for spec in _iter_ticket_role_specs():
            if spec.nocodb_value.startswith("fes-"):
                style = discord.ButtonStyle.primary  # blue
            elif spec.nocodb_value.startswith("expo-"):
                style = discord.ButtonStyle.success  # green
            elif spec.key == "zenloss":
                style = discord.ButtonStyle.danger  # red
            else:
                style = discord.ButtonStyle.secondary

            label = spec.label_ja
            if spec.key == "fes_stage1":
                label = "STAGE1"
            elif spec.key == "fes_stage2":
                label = "STAGE2"
            elif spec.key == "fes_stage3":
                label = "STAGE3"
            elif spec.key == "fes_stage4":
                label = "STAGE4"
            elif spec.key == "expo_day1":
                label = "EXPO Day 1"
            elif spec.key == "expo_day2":
                label = "EXPO Day 2"
            elif spec.key == "expo_day3":
                label = "EXPO Day 3"
            elif spec.key == "zenloss":
                label = "zenloss 全ロス"

            btn = discord.ui.Button(
                label=label,
                style=style,
                custom_id=f"offkai:ticketrole:{spec.key}",
                row=spec.row,
            )
            btn.callback = self._make_callback(spec)  # type: ignore[assignment]
            self.add_item(btn)

    def _make_callback(self, spec: TicketRoleSpec):
        async def _cb(interaction: discord.Interaction) -> None:
            if interaction.guild is None:
                await _respond_ephemeral(interaction, "サーバー内でのみ利用できます。")
                return
            if interaction.user is None:
                await _respond_ephemeral(
                    interaction, "ユーザー情報を取得できませんでした。"
                )
                return

            try:
                if isinstance(interaction.user, discord.Member):
                    member = interaction.user
                else:
                    member = await interaction.guild.fetch_member(interaction.user.id)
            except discord.HTTPException:
                log.exception("Failed to fetch member for ticket role toggle")
                await _respond_ephemeral(
                    interaction, "ユーザー情報を取得できませんでした。"
                )
                return

            role = _find_role_by_candidates(
                interaction.guild, spec.role_name_candidates
            )
            if role is None:
                await _respond_ephemeral(
                    interaction,
                    "ロールが見つかりません。\n"
                    f"候補: {', '.join(spec.role_name_candidates)}",
                )
                return

            # Compute current ticket keys based on currently-held roles.
            resolved_roles: dict[str, discord.Role] = {}
            specs_by_key: dict[str, TicketRoleSpec] = {
                s.key: s for s in _iter_ticket_role_specs()
            }
            for s in _iter_ticket_role_specs():
                r = _find_role_by_candidates(interaction.guild, s.role_name_candidates)
                if r is not None:
                    resolved_roles[s.key] = r

            current_keys: set[str] = {
                k
                for (k, r) in resolved_roles.items()
                if r in getattr(member, "roles", [])
            }
            next_keys = set(current_keys)

            try:
                if role in member.roles:
                    await member.remove_roles(role, reason="Self-assign ticket role")
                    next_keys.discard(spec.key)
                    is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))
                    current_txt, _ = _format_current_ticket_roles_mention_list(
                        guild=interaction.guild,
                        member=member,
                        is_ja=is_ja_client,
                    )
                    await _respond_ephemeral(
                        interaction,
                        _msg(
                            is_ja_client,
                            f"外しました: {role.name}\n{current_txt}",
                            f"Removed: {role.name}\n{current_txt}",
                        ),
                    )
                else:
                    # Enforce mutual exclusivity:
                    # - If adding zenloss: remove all other ticket/day roles first.
                    # - If adding any other role: remove zenloss first.
                    if spec.key == "zenloss":
                        to_remove: list[discord.Role] = []
                        for other in _iter_ticket_role_specs():
                            if other.key == spec.key:
                                continue
                            other_role = _find_role_by_candidates(
                                interaction.guild, other.role_name_candidates
                            )
                            if other_role and other_role in member.roles:
                                to_remove.append(other_role)
                        if to_remove:
                            await member.remove_roles(
                                *to_remove,
                                reason="Self-assign zenloss (exclusive)",
                            )
                        # zenloss is exclusive; keep only it.
                        next_keys = {"zenloss"}
                    else:
                        zen_spec = next(
                            (
                                s
                                for s in _iter_ticket_role_specs()
                                if s.key == "zenloss"
                            ),
                            None,
                        )
                        if zen_spec is not None:
                            zen_role = _find_role_by_candidates(
                                interaction.guild, zen_spec.role_name_candidates
                            )
                            if zen_role and zen_role in member.roles:
                                await member.remove_roles(
                                    zen_role,
                                    reason="Self-assign ticket role (exclusive with zenloss)",
                                )
                        next_keys.discard("zenloss")

                    next_keys.add(spec.key)

                    await member.add_roles(role, reason="Self-assign ticket role")
                    is_ja_client = _is_ja_locale(getattr(interaction, "locale", None))
                    current_txt, _ = _format_current_ticket_roles_mention_list(
                        guild=interaction.guild,
                        member=member,
                        is_ja=is_ja_client,
                    )
                    await _respond_ephemeral(
                        interaction,
                        _msg(
                            is_ja_client,
                            f"付けました: {role.name}\n{current_txt}",
                            f"Added: {role.name}\n{current_txt}",
                        ),
                    )

                # Persist ticket keys to NocoDB (best-effort).
                if self._repo is not None:
                    try:
                        nocodb_values: list[str] = []
                        for k in sorted(next_keys):
                            s = specs_by_key.get(k)
                            if s is None:
                                continue
                            nocodb_values.append(s.nocodb_value)
                        await self._repo.set_member_tickets(
                            guild_id=int(interaction.guild.id),
                            user_id=int(member.id),
                            display_name=str(member.display_name),
                            username=str(member.name),
                            ticket_keys=nocodb_values,
                        )
                    except Exception:
                        log.exception(
                            "Failed to persist ticket roles to NocoDB guild_id=%s user_id=%s",
                            interaction.guild.id,
                            member.id,
                        )
            except discord.Forbidden:
                await _respond_ephemeral(
                    interaction,
                    "権限不足でロールを変更できません（Botのロール階層/権限を確認してください）。",
                )
            except discord.HTTPException:
                log.exception("Failed to toggle ticket role")
                await _respond_ephemeral(interaction, "ロール変更に失敗しました。")

        return _cb


def _build_ticket_roles_embed(
    *, title: str, description: Optional[str]
) -> discord.Embed:
    embed = discord.Embed(
        title=title,
        description=description
        or (
            "どのチケットを確保していますか？\n"
            "（ロールはいつでも付け外しできます。参加登録とは無関係です）\n\n"
            "Which tickets do you currently have?\n"
            "(You can add/remove roles anytime. Independent from registration.)"
        ),
        colour=discord.Colour.dark_teal(),
    )
    return embed


def _build_panel_embed(*, title: str, description: Optional[str]) -> discord.Embed:
    # NOTE: 規約/注意事項の「更新日」は Embed に書かず、Discordの送信日時そのものを証跡にする。
    # そのためパネル内容を変えたい場合は message.edit ではなく「削除→再投稿」で運用する。
    embed = discord.Embed(
        title=title,
        description=description
        or (
            "下のボタンから参加登録できます。\n"
            "You can register using the button below.\n\n"
            "**押下＝同意 / Pressing the button means you agree**"
        ),
        colour=discord.Colour.blurple(),
    )
    return embed


class OffkaiCog(commands.Cog):
    offkai = discord.SlashCommandGroup(
        "offkai",
        "Off-Kai 参加登録を管理します",
        # サーバー管理者(Administrator)のみ。
        default_member_permissions=discord.Permissions(administrator=True),
        contexts=[InteractionContextType.guild],
        integration_types=[IntegrationType.guild_install],
    )

    def __init__(self, bot: discord.Bot, *, repo: OffkaiNocoDbRepo) -> None:
        self.bot = bot
        self.repo = repo
        if not self._has_paid_role_sync_loop.is_running():
            self._has_paid_role_sync_loop.start()

    def cog_unload(self) -> None:
        if self._has_paid_role_sync_loop.is_running():
            self._has_paid_role_sync_loop.cancel()

    async def _sync_has_paid_role_for_event(
        self,
        *,
        guild: discord.Guild,
        event_id: int,
    ) -> tuple[int, int, int]:
        ev = await self.repo.get_event(event_id)
        if not ev:
            return (0, 0, 1)

        evf = _nc_fields(ev)
        has_paid_role_id = _parse_role_id(
            str(evf.get("has_paid_role_id")) if evf.get("has_paid_role_id") else None
        )
        if not has_paid_role_id:
            return (0, 0, 0)

        paid_role = guild.get_role(int(has_paid_role_id))
        if paid_role is None:
            log.warning(
                "sync_has_paid_role role not found guild_id=%s event_id=%s role_id=%s",
                guild.id,
                event_id,
                has_paid_role_id,
            )
            return (0, 0, 1)

        regs = await self.repo.list_registrations_for_event(event_id=event_id)

        paid_member_ids: list[int] = []
        for r in regs:
            rf = _nc_fields(r)
            if not bool(rf.get("has_paid")):
                continue
            mid = _registration_member_id(rf)
            if mid is not None:
                paid_member_ids.append(mid)

        members_by_id = await self.repo.list_members_by_ids(
            member_ids=list(sorted(set(paid_member_ids)))
        )

        added = 0
        missing = 0
        failed = 0

        for mid in sorted(set(paid_member_ids)):
            member_rec = members_by_id.get(int(mid))
            user_id = _nc_int(_nc_fields(member_rec).get("user_id"))
            if user_id is None:
                failed += 1
                continue

            try:
                guild_member = await guild.fetch_member(int(user_id))
            except discord.NotFound:
                missing += 1
                continue
            except discord.HTTPException:
                failed += 1
                continue

            try:
                if paid_role not in guild_member.roles:
                    await guild_member.add_roles(
                        paid_role,
                        reason="Registration payment confirmed",
                    )
                    added += 1
            except discord.HTTPException:
                failed += 1

        return (added, missing, failed)

    @tasks.loop(minutes=HAS_PAID_ROLE_SYNC_INTERVAL_MINUTES)
    async def _has_paid_role_sync_loop(self) -> None:
        for guild in self.bot.guilds:
            try:
                events = await self.repo.list_events_for_guild(guild_id=guild.id)
            except Exception:
                log.exception(
                    "has_paid_role_sync failed to list events guild_id=%s",
                    guild.id,
                )
                continue

            for ev in events:
                event_id = _nc_int(ev.get("id"))
                if event_id is None:
                    continue
                try:
                    await self._sync_has_paid_role_for_event(
                        guild=guild,
                        event_id=int(event_id),
                    )
                except Exception:
                    log.exception(
                        "has_paid_role_sync failed guild_id=%s event_id=%s",
                        guild.id,
                        event_id,
                    )

    @_has_paid_role_sync_loop.before_loop
    async def _before_has_paid_role_sync_loop(self) -> None:
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_member_update(
        self, before: discord.Member, after: discord.Member
    ) -> None:
        """Listen for member updates (nickname/display name changes) and sync to NocoDB."""
        # Only process if either display_name or username changed.
        if before.display_name == after.display_name and before.name == after.name:
            return

        guild_id = after.guild.id
        user_id = after.id
        new_display_name = after.display_name
        new_username = after.name

        try:
            # Find existing member record in NocoDB
            member_rec = await self.repo.find_member(guild_id=guild_id, user_id=user_id)
            if member_rec:
                member_id = _nc_int(member_rec.get("id"))
                if member_id is not None:
                    # Update display_name in NocoDB
                    await self.repo.update_member(
                        member_id=member_id,
                        fields={
                            "display_name": new_display_name,
                            "username": new_username,
                        },
                    )

                    # Also keep denormalized registration.display_name fresh.
                    # (Registrations are linked via FK column member_id.)
                    updated_regs = 0
                    try:
                        updated_regs = (
                            await self.repo.sync_registration_display_name_for_member(
                                member_id=member_id,
                                display_name=new_display_name,
                            )
                        )
                    except Exception:
                        # Best-effort: do not fail the whole handler.
                        log.exception(
                            "on_member_update failed to sync registration display_name guild_id=%s user_id=%s member_id=%s",
                            guild_id,
                            user_id,
                            member_id,
                        )
                    log.info(
                        "on_member_update synced profile guild_id=%s user_id=%s member_id=%s old_display_name=%s new_display_name=%s old_username=%s new_username=%s updated_regs=%s",
                        guild_id,
                        user_id,
                        member_id,
                        before.display_name,
                        new_display_name,
                        before.name,
                        new_username,
                        updated_regs,
                    )
        except Exception:
            log.exception(
                "on_member_update failed to sync display_name guild_id=%s user_id=%s",
                guild_id,
                user_id,
            )

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member) -> None:
        """Mark member as out-of-guild in NocoDB when they leave the server."""
        guild_id = member.guild.id
        user_id = member.id

        try:
            member_rec = await self.repo.find_member(guild_id=guild_id, user_id=user_id)
            if not member_rec:
                return
            member_id = _nc_int(member_rec.get("id"))
            if member_id is None:
                return

            await self.repo.update_member(
                member_id=member_id, fields={"in_guild": False}
            )
            log.info(
                "on_member_remove marked in_guild=false guild_id=%s user_id=%s member_id=%s",
                guild_id,
                user_id,
                member_id,
            )
        except Exception:
            log.exception(
                "on_member_remove failed to update in_guild guild_id=%s user_id=%s",
                guild_id,
                user_id,
            )

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member) -> None:
        """Best-effort mark member as in-guild again when they re-join."""
        try:
            # Create if missing; also refresh display_name and in_guild.
            await self.repo.get_or_create_member(
                guild_id=member.guild.id,
                user_id=member.id,
                display_name=member.display_name,
                username=member.name,
            )
        except Exception:
            log.exception(
                "on_member_join failed to upsert in_guild guild_id=%s user_id=%s",
                member.guild.id,
                member.id,
            )

    @offkai.command(description="イベントを作成します")
    async def event_create(
        self,
        ctx: discord.ApplicationContext,
        name: str = Option(str, "表示名", min_length=1, max_length=200),  # type: ignore[assignment]
        capacity_confirmed: int = Option(
            int, "確定枠の定員", min_value=0, max_value=10000
        ),  # type: ignore[assignment]
        is_open: bool = Option(bool, "受付を開始する", default=False),  # type: ignore[assignment]
        confirmed_role_id: Optional[str] = Option(
            str, "確定ロールID(任意)", required=False, default=None
        ),  # type: ignore[assignment]
        waitlist_role_id: Optional[str] = Option(
            str, "ウェイトリストロールID(任意)", required=False, default=None
        ),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return
            if ctx.guild is None:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return

            conf_role = _parse_role_id(confirmed_role_id)
            wait_role = _parse_role_id(waitlist_role_id)

            event_id = await self.repo.create_event(
                title=name,
                capacity=capacity_confirmed,
                guild_id=ctx.guild.id,
                participant_role_id=conf_role,
                pending_role_id=wait_role,
            )

            await ctx.followup.send(
                f"イベントを作成しました: id={event_id}",
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "event_create failed error_id=%s guild_id=%s user_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="イベントの確定/ウェイトリストのロールIDを設定します")
    async def event_set_roles(
        self,
        ctx: discord.ApplicationContext,
        event_id: int = Option(int, "対象イベントID"),  # type: ignore[assignment]
        confirmed_role_id: Optional[str] = Option(
            str,
            "確定ロールID (未設定にする場合は空欄/省略)",
            required=False,
            default=None,
        ),  # type: ignore[assignment]
        waitlist_role_id: Optional[str] = Option(
            str,
            "ウェイトリストロールID (未設定にする場合は空欄/省略)",
            required=False,
            default=None,
        ),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return

            conf_role = _parse_role_id(confirmed_role_id)
            wait_role = _parse_role_id(waitlist_role_id)

            ev = await self.repo.get_event(event_id)
            if not ev:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "イベントが見つかりません。",
                        "Event was not found.",
                    ),
                    ephemeral=True,
                )
                return

            await self.repo.update_event(
                event_id=event_id,
                fields={
                    "participant_role_id": str(conf_role) if conf_role else "",
                    "pending_role_id": str(wait_role) if wait_role else "",
                },
            )

            await ctx.followup.send(
                f"更新しました: id={event_id} participant_role_id={conf_role} pending_role_id={wait_role}\n"
                "※既存参加者への反映は /offkai roles_sync を実行してください。",
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "event_set_roles failed error_id=%s guild_id=%s user_id=%s event_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="イベントの受付を開始/停止します")
    async def event_set_open(
        self,
        ctx: discord.ApplicationContext,
        event_id: int = Option(int, "対象イベントID"),  # type: ignore[assignment]
        is_open: bool = Option(bool, "受付を開始するか", default=True),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return

            # NocoDBの現行スキーマには is_open フィールドが無いため、互換維持のために明示メッセージだけ返す。
            # 必要なら event テーブルに Checkbox の is_open を追加して、ここで update_event する実装に拡張可能。
            _ = (event_id, is_open)
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    "NocoDB側の event テーブルに is_open が無いので、このコマンドは現在無効です。\n"
                    "(必要なら event に Checkbox: is_open を追加してください)",
                    "This command is currently disabled because the NocoDB 'event' table has no 'is_open' field.\n"
                    "(If needed, add a Checkbox field 'is_open' to the event table.)",
                ),
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "event_set_open failed error_id=%s guild_id=%s user_id=%s event_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="確定枠の定員を変更します")
    async def event_set_capacity(
        self,
        ctx: discord.ApplicationContext,
        event_id: int = Option(int, "対象イベントID"),  # type: ignore[assignment]
        capacity_confirmed: int = Option(
            int, "確定枠の定員", min_value=0, max_value=10000
        ),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return

            ev = await self.repo.get_event(event_id)
            if not ev:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "イベントが見つかりません。",
                        "Event was not found.",
                    ),
                    ephemeral=True,
                )
                return

            await self.repo.update_event(
                event_id=event_id,
                fields={"capacity": capacity_confirmed},
            )

            await ctx.followup.send(
                f"更新しました: id={event_id} capacity={capacity_confirmed}",
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "event_set_capacity failed error_id=%s guild_id=%s user_id=%s event_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="登録ステータスに基づきロールを一括同期します")
    async def roles_sync(
        self,
        ctx: discord.ApplicationContext,
        event_id: int = Option(int, "対象イベントID"),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if ctx.guild is None:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return

            ev = await self.repo.get_event(event_id)
            if not ev:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "イベントが見つかりません。",
                        "Event was not found.",
                    ),
                    ephemeral=True,
                )
                return

            evf = _nc_fields(ev)
            participant_role_id = _parse_role_id(
                str(evf.get("participant_role_id"))
                if evf.get("participant_role_id")
                else None
            )
            pending_role_id = _parse_role_id(
                str(evf.get("pending_role_id")) if evf.get("pending_role_id") else None
            )

            regs = await self.repo.list_registrations_for_event(event_id=event_id)
            member_ids: list[int] = []
            for r in regs:
                mid = _registration_member_id(_nc_fields(r))
                if mid is not None:
                    member_ids.append(mid)

            members_by_id = await self.repo.list_members_by_ids(
                member_ids=list(sorted(set(member_ids)))
            )

            ok = 0
            missing = 0
            failed = 0

            for r in regs:
                rf = _nc_fields(r)
                is_confirmed = bool(rf.get("is_confirmed"))

                # Resolve discord user id via linked member.
                member_rec: Optional[dict[str, Any]] = None
                mid = _registration_member_id(rf)
                if mid is not None:
                    member_rec = members_by_id.get(mid)

                user_id_raw = (
                    _nc_fields(member_rec).get("user_id") if member_rec else None
                )
                user_id = _nc_int(user_id_raw)
                if user_id is None:
                    failed += 1
                    continue

                try:
                    member = await ctx.guild.fetch_member(int(user_id))
                except discord.NotFound:
                    missing += 1
                    continue
                except discord.HTTPException:
                    failed += 1
                    continue

                try:
                    await _apply_roles_to_member(
                        member,
                        confirmed_role_id=participant_role_id,
                        waitlist_role_id=pending_role_id,
                        status=(STATUS_CONFIRMED if is_confirmed else STATUS_WAITLIST),
                    )
                    ok += 1
                except Exception:
                    failed += 1
                    log.exception("roles_sync failed for user_id=%s", user_id)

            paid_added, paid_missing, paid_failed = (
                await self._sync_has_paid_role_for_event(
                    guild=ctx.guild,
                    event_id=event_id,
                )
            )

            await ctx.followup.send(
                (
                    "ロール同期完了: "
                    f"ok={ok} missing={missing} failed={failed} "
                    f"paid_added={paid_added} paid_missing={paid_missing} paid_failed={paid_failed}"
                ),
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "roles_sync failed error_id=%s guild_id=%s user_id=%s event_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(
        description="memberテーブルの display_name / username / in_guild を一括同期します"
    )
    async def members_sync_profile(
        self,
        ctx: discord.ApplicationContext,
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if ctx.guild is None:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return

            member_records = await self.repo.list_members_for_guild(
                guild_id=ctx.guild.id
            )

            synced = 0
            marked_out = 0
            failed = 0
            regs_updated = 0

            for rec in member_records:
                member_id = _nc_int(rec.get("id"))
                user_id = _nc_int(_nc_fields(rec).get("user_id"))
                if member_id is None or user_id is None:
                    failed += 1
                    continue

                try:
                    discord_member = await ctx.guild.fetch_member(int(user_id))
                except discord.NotFound:
                    try:
                        await self.repo.update_member(
                            member_id=int(member_id),
                            fields={"in_guild": False},
                        )
                        marked_out += 1
                    except Exception:
                        failed += 1
                        log.exception(
                            "members_sync_profile failed to mark out-of-guild guild_id=%s member_id=%s user_id=%s",
                            ctx.guild.id,
                            member_id,
                            user_id,
                        )
                    continue
                except discord.HTTPException:
                    failed += 1
                    continue

                try:
                    await self.repo.update_member(
                        member_id=int(member_id),
                        fields={
                            "display_name": str(discord_member.display_name),
                            "username": str(discord_member.name),
                            "in_guild": True,
                        },
                    )
                    synced += 1
                    try:
                        regs_updated += (
                            await self.repo.sync_registration_display_name_for_member(
                                member_id=int(member_id),
                                display_name=str(discord_member.display_name),
                            )
                        )
                    except Exception:
                        log.exception(
                            "members_sync_profile failed to sync registration display_name guild_id=%s member_id=%s user_id=%s",
                            ctx.guild.id,
                            member_id,
                            user_id,
                        )
                except Exception:
                    failed += 1
                    log.exception(
                        "members_sync_profile failed to update member guild_id=%s member_id=%s user_id=%s",
                        ctx.guild.id,
                        member_id,
                        user_id,
                    )

            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    (
                        "member同期完了: "
                        f"synced={synced} marked_out={marked_out} failed={failed} "
                        f"registration_display_name_updated={regs_updated}"
                    ),
                    (
                        "Member sync completed: "
                        f"synced={synced} marked_out={marked_out} failed={failed} "
                        f"registration_display_name_updated={regs_updated}"
                    ),
                ),
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "members_sync_profile failed error_id=%s guild_id=%s user_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Request failed. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="参加登録パネル(ボタン)を設置します")
    async def panel_create(
        self,
        ctx: discord.ApplicationContext,
        event_id: int = Option(int, "対象イベントID"),  # type: ignore[assignment]
        channel: Optional[discord.TextChannel] = Option(  # type: ignore[assignment]
            discord.TextChannel,
            "設置先チャンネル (省略時は現在のチャンネル)",
            required=False,
            default=None,
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        ),
        lang: str = Option(
            str,
            "言語 (ja/en)",
            required=False,
            default="ja",
            choices=[
                OptionChoice(name="ja (日本語)", value="ja"),
                OptionChoice(name="en (English)", value="en"),
            ],
        ),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return
            if ctx.guild is None:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return

            target_channel = channel or ctx.channel
            if target_channel is None or not isinstance(
                target_channel, discord.TextChannel
            ):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "テキストチャンネルを指定してください。",
                        "Please specify a text channel.",
                    ),
                    ephemeral=True,
                )
                return

            ev = await self.repo.get_event(event_id)
            if not ev:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "イベントが見つかりません。",
                        "Event was not found.",
                    ),
                    ephemeral=True,
                )
                return

            log.info(
                "panel_create start guild_id=%s user_id=%s event_id=%s channel_id=%s lang=%s",
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
                target_channel.id,
                _normalize_lang(lang),
            )

            # Insert panel first to get id, then send message, then update message_id.
            # パネル本文は長文になりがちなので、スラッシュコマンド引数で入力させずに
            # data/offkai_panel_content.json から読み込みます。
            lang_norm = _normalize_lang(lang)

            # Build embeds -> JSON (discord expects this shape). We store this JSON in NocoDB panel.embed.
            embed_objs = _build_registration_panel_embeds_for(
                lang=lang_norm,
                override_title=None,
            )

            # Embed.to_dict() returns the payload dict Discord expects (keys like 'title', 'description', 'color', ...).
            embeds_json: list[dict[str, Any]] = []
            for idx, e in enumerate(embed_objs):
                # Some stubs type this loosely; coerce to a plain dict for mypy/pyright friendliness.
                payload: dict[str, Any] = dict(e.to_dict())  # type: ignore[arg-type]
                if not isinstance(payload, dict):
                    raise RuntimeError(
                        f"Embed.to_dict() did not return a dict (idx={idx})"
                    )
                embeds_json.append(payload)

            embed_blob: dict[str, Any] = {"embeds": embeds_json}
            first_title = str(
                embed_objs[0].title
                or ("参加申し込み" if lang_norm == "ja" else "Registration")
            )

            panel_id, _panel = await self.repo.create_panel(
                event_id=event_id,
                channel_id=target_channel.id,
                title=first_title,
                description="",
                language=lang_norm,
                embed=embed_blob,  # type: ignore[arg-type]
            )

            log.info(
                "panel_create db_created guild_id=%s event_id=%s panel_id=%s channel_id=%s lang=%s",
                ctx.guild.id if ctx.guild else None,
                event_id,
                int(panel_id),
                target_channel.id,
                lang_norm,
            )

            custom_id_prefix = _registration_custom_id_prefix_for_panel(panel_id)

            view = RegistrationView(
                repo=self.repo,
                panel=PanelConfig(
                    panel_id=panel_id,
                    event_id=event_id,
                    custom_id_prefix=custom_id_prefix,
                    lang=lang_norm,
                ),
                button_label_register=_registration_button_label(lang_norm),
            )

            # Send using JSON->Embed so we're guaranteed it's round-trippable.
            message_embeds = [discord.Embed.from_dict(p) for p in embeds_json]
            message = await target_channel.send(embeds=message_embeds, view=view)

            log.info(
                "panel_create message_sent guild_id=%s channel_id=%s message_id=%s panel_id=%s",
                ctx.guild.id if ctx.guild else None,
                target_channel.id,
                message.id,
                int(panel_id),
            )

            await self.repo.set_panel_message_id(
                panel_id=panel_id, message_id=message.id
            )

            log.info(
                "panel_create message_id_saved panel_id=%s message_id=%s",
                int(panel_id),
                message.id,
            )

            self.bot.add_view(view, message_id=message.id)
            await ctx.followup.send(
                f"パネルを設置しました: <#{target_channel.id}> (lang={lang}, message_id={message.id})",
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "panel_create failed error_id=%s guild_id=%s user_id=%s event_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
                event_id,
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"パネルの設置に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Failed to create the panel. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(description="アンケート(チケット/日程)パネルを設置します")
    async def ticket_roles_panel_create(
        self,
        ctx: discord.ApplicationContext,
        channel: Optional[discord.TextChannel] = Option(  # type: ignore[assignment]
            discord.TextChannel,
            "設置先チャンネル (省略時は現在のチャンネル)",
            required=False,
            default=None,
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        ),
        embed_title: str = Option(
            str,
            "埋め込みタイトル",
            required=False,
            default="アンケート / Survey",
            max_length=100,
        ),  # type: ignore[assignment]
        description: Optional[str] = Option(
            str,
            "説明(任意)",
            required=False,
            default=None,
            max_length=400,
        ),  # type: ignore[assignment]
    ) -> None:
        await ctx.defer(ephemeral=True)
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return
            if ctx.guild is None:
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return

            target_channel = channel or ctx.channel
            if target_channel is None or not isinstance(
                target_channel, discord.TextChannel
            ):
                await ctx.followup.send(
                    _msg(
                        is_ja_client,
                        "テキストチャンネルを指定してください。",
                        "Please specify a text channel.",
                    ),
                    ephemeral=True,
                )
                return

            view = TicketRolesView(repo=self.repo)
            message = await target_channel.send(
                embed=_build_ticket_roles_embed(
                    title=embed_title, description=description
                ),
                view=view,
            )
            await ctx.followup.send(
                f"アンケートパネルを設置しました: <#{target_channel.id}> (message_id={message.id})",
                ephemeral=True,
            )
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "ticket_roles_panel_create failed error_id=%s guild_id=%s user_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
            )
            await ctx.followup.send(
                _msg(
                    is_ja_client,
                    f"パネルの設置に失敗しました。運営に連絡してください (error_id={err_id})",
                    f"Failed to create the panel. Please contact an organizer. (error_id={err_id})",
                ),
                ephemeral=True,
            )

    @offkai.command(
        description="Botとしてメッセージを送信します（本文なしの場合はモーダル）"
    )
    async def say(
        self,
        ctx: discord.ApplicationContext,
        channel: Optional[discord.TextChannel] = Option(  # type: ignore[assignment]
            discord.TextChannel,
            "送信先チャンネル (省略時は現在のチャンネル)",
            required=False,
            default=None,
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        ),
        message: Optional[str] = Option(  # type: ignore[assignment]
            str,
            "送信内容（任意。未指定の場合はモーダル）",
            required=False,
            default=None,
            max_length=2000,
        ),
        image: Optional[discord.Attachment] = Option(  # type: ignore[assignment]
            discord.Attachment,
            "画像（任意）",
            required=False,
            default=None,
        ),
        image2: Optional[discord.Attachment] = Option(  # type: ignore[assignment]
            discord.Attachment,
            "画像2（任意）",
            required=False,
            default=None,
        ),
        image3: Optional[discord.Attachment] = Option(  # type: ignore[assignment]
            discord.Attachment,
            "画像3（任意）",
            required=False,
            default=None,
        ),
        image4: Optional[discord.Attachment] = Option(  # type: ignore[assignment]
            discord.Attachment,
            "画像4（任意）",
            required=False,
            default=None,
        ),
    ) -> None:
        # NOTE: モーダルを開く場合は defer しない（モーダル送信に失敗するため）。
        is_ja_client = _is_ja_locale(
            getattr(ctx, "locale", None)
            or getattr(getattr(ctx, "interaction", None), "locale", None)
        )
        did_defer = False
        try:
            if not _ensure_manage_guild(ctx):
                await ctx.respond(
                    _msg(
                        is_ja_client,
                        "サーバー管理権限が必要です。",
                        "Administrator permission is required.",
                    ),
                    ephemeral=True,
                )
                return
            if ctx.guild is None:
                await ctx.respond(
                    _msg(
                        is_ja_client,
                        "サーバー内でのみ実行できます。",
                        "This can only be used in a server.",
                    ),
                    ephemeral=True,
                )
                return

            target_channel = channel or ctx.channel
            if target_channel is None or not isinstance(
                target_channel, discord.TextChannel
            ):
                await ctx.respond(
                    _msg(
                        is_ja_client,
                        "テキストチャンネルを指定してください。",
                        "Please specify a text channel.",
                    ),
                    ephemeral=True,
                )
                return

            attachments: list[discord.Attachment] = [
                a for a in (image, image2, image3, image4) if a is not None
            ]

            # If only images are provided (no message), open modal so users can type multi-line.
            msg = (message or "").strip() or None
            if msg is None and attachments:
                interaction = getattr(ctx, "interaction", None)
                if interaction is None or not hasattr(
                    getattr(interaction, "response", None), "send_modal"
                ):
                    await ctx.respond(
                        _msg(
                            is_ja_client,
                            "この環境ではモーダルを開けません。",
                            "Unable to open a modal in this environment.",
                        ),
                        ephemeral=True,
                    )
                    return

                modal = SayModal(
                    target_channel_id=int(target_channel.id),
                    locale_code=_locale_code(
                        getattr(ctx, "locale", None)
                        or getattr(getattr(ctx, "interaction", None), "locale", None)
                    ),
                    attachments=attachments,
                )
                await interaction.response.send_modal(modal)
                return

            # If message is provided (with or without images), send directly (no modal).
            if msg is not None or attachments:
                await ctx.defer(ephemeral=True)
                did_defer = True

                for att in attachments:
                    if not _is_image_attachment(att):
                        await ctx.followup.send(
                            _msg(
                                is_ja_client,
                                "画像ファイルを指定してください。",
                                "Please provide image files.",
                            ),
                            ephemeral=True,
                        )
                        return

                files: list[discord.File] = []
                for att in attachments:
                    files.append(await att.to_file(use_cached=True))

                if files:
                    await target_channel.send(
                        content=msg,
                        files=files,
                        allowed_mentions=_allowed_mentions_all(),
                    )
                else:
                    await target_channel.send(
                        content=msg,
                        allowed_mentions=_allowed_mentions_all(),
                    )

                await ctx.followup.send(
                    _msg(is_ja_client, "送信しました。", "Sent."),
                    ephemeral=True,
                )
                return

            interaction = getattr(ctx, "interaction", None)
            if interaction is None or not hasattr(
                getattr(interaction, "response", None), "send_modal"
            ):
                await ctx.respond(
                    _msg(
                        is_ja_client,
                        "この環境ではモーダルを開けません。",
                        "Unable to open a modal in this environment.",
                    ),
                    ephemeral=True,
                )
                return

            modal = SayModal(
                target_channel_id=int(target_channel.id),
                locale_code=_locale_code(
                    getattr(ctx, "locale", None)
                    or getattr(getattr(ctx, "interaction", None), "locale", None)
                ),
            )
            await interaction.response.send_modal(modal)
        except Exception:
            err_id = secrets.token_hex(4)
            log.exception(
                "offkai.say failed error_id=%s guild_id=%s user_id=%s",
                err_id,
                ctx.guild.id if ctx.guild else None,
                getattr(ctx.author, "id", None),
            )
            try:
                # If we already deferred, use followup.
                if did_defer:
                    await ctx.followup.send(
                        _msg(
                            is_ja_client,
                            f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                            f"Request failed. Please contact an organizer. (error_id={err_id})",
                        ),
                        ephemeral=True,
                    )
                else:
                    await ctx.respond(
                        _msg(
                            is_ja_client,
                            f"処理に失敗しました。運営に連絡してください (error_id={err_id})",
                            f"Request failed. Please contact an organizer. (error_id={err_id})",
                        ),
                        ephemeral=True,
                    )
            except Exception:
                pass

    # NOTE: CSV出力/集計/ダッシュボード等の「便利機能」はNocoDB側で完結できるため、
    # Discord Bot 側からは撤去しました。


async def register_persistent_views(
    bot: discord.Bot, *, repo: OffkaiNocoDbRepo
) -> None:
    # DBに紐づかないセルフロールViewはグローバルに永続登録しておく。
    # （過去に送ったメッセージでも、custom_id が一致すれば動く）
    bot.add_view(TicketRolesView(repo=repo))

    panels = await repo.list_panels()

    log.info(
        "register_persistent_views start panels=%s",
        len(panels),
    )

    registered = 0
    skipped = 0

    for p in panels:
        pf = _nc_fields(p)
        message_id = _nc_int(pf.get("message_id"), default=0) or 0
        panel_id = _nc_int(p.get("id"))
        if panel_id is None:
            log.warning(
                "register_persistent_views skip missing panel_id message_id=%s",
                message_id,
            )
            skipped += 1
            continue

        custom_id_prefix = _registration_custom_id_prefix_for_panel(int(panel_id))

        # panel table has stable ForeignKey column event_id.
        event_id: Optional[int] = _nc_int(pf.get("event_id"))
        if not event_id:
            log.warning(
                "register_persistent_views skip missing event_id panel_id=%s message_id=%s",
                int(panel_id),
                message_id,
            )
            skipped += 1
            continue

        lang = _normalize_lang(str(pf.get("language") or ""))

        panel = PanelConfig(
            panel_id=int(panel_id),
            event_id=int(event_id),
            custom_id_prefix=custom_id_prefix,
            lang=lang,
        )
        view = RegistrationView(
            repo=repo,
            panel=panel,
            button_label_register=_registration_button_label(panel.lang),
        )

        try:
            if message_id > 0:
                bot.add_view(view, message_id=int(message_id))
            else:
                # Fallback: still register as persistent without message binding.
                bot.add_view(view)
            registered += 1

            log.info(
                "register_persistent_views registered panel_id=%s event_id=%s message_id=%s lang=%s",
                panel.panel_id,
                panel.event_id,
                message_id,
                panel.lang,
            )
        except Exception:
            skipped += 1
            log.exception(
                "Failed to register persistent RegistrationView panel_id=%s event_id=%s message_id=%s",
                panel.panel_id,
                panel.event_id,
                message_id,
            )

    log.info(
        "Persistent views registered: registration_panels=%s skipped=%s",
        registered,
        skipped,
    )
