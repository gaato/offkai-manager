import logging
import os
import re
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import discord
from discord import (
    AutocompleteContext,
    InteractionContextType,
    IntegrationType,
    Option,
    OptionChoice,
)
from discord.ext import commands
from dotenv import load_dotenv

from offkai_manager.storage import FormButtonConfig, FormButtonStorage

logging.basicConfig(level=logging.INFO)

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "form_buttons.json"

BUTTON_STYLE_CHOICES = {
    "blurple": discord.ButtonStyle.primary,
    "gray": discord.ButtonStyle.secondary,
    "green": discord.ButtonStyle.success,
    "red": discord.ButtonStyle.danger,
}

BUTTON_STYLE_LABELS = {
    "blurple": "Blurple · Discord標準",
    "gray": "Gray · 2次アクション",
    "green": "Green · 成功/承認",
    "red": "Red · 注意/中止",
}

DEFAULT_BUTTON_LABEL = "フォームを開く"
DEFAULT_EMBED_TITLE = "Googleフォーム回答リンク / Google Form Link"


def resolve_locale_code(source: Any) -> Optional[str]:
    if source is None:
        return None
    locale = getattr(source, "locale", None)
    if locale:
        return str(locale).lower()
    interaction = getattr(source, "interaction", None)
    if interaction is not None:
        nested_locale = getattr(interaction, "locale", None)
        if nested_locale:
            return str(nested_locale).lower()
    return None


def localize_text(locale_code: Optional[str], ja: str, en: str) -> str:
    if locale_code and locale_code.startswith("ja"):
        return ja
    if locale_code:
        return en
    return f"{ja}\n\n{en}"


async def button_style_autocomplete(ctx: AutocompleteContext):
    """Suggest button style keywords based on the user's input."""

    current = (ctx.value or "").lower()
    suggestions = []
    for key, label in BUTTON_STYLE_LABELS.items():
        haystack = f"{key} {label}".lower()
        if not current or current in haystack:
            suggestions.append(OptionChoice(name=label, value=key))
    return suggestions[:25]


def sanitize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def normalize_button_style(
    value: Optional[str], *, locale_code: Optional[str] = None
) -> str:
    key = (value or "blurple").lower().strip()
    if key not in BUTTON_STYLE_CHOICES:
        raise ValueError(
            localize_text(
                locale_code,
                "サポートされていないボタンカラーです。",
                "The specified button color is not supported.",
            )
        )
    return key


def _build_form_url(form_id: str, *, use_event_mode: bool) -> str:
    prefix = "e/" if use_event_mode else ""
    return f"https://docs.google.com/forms/d/{prefix}{form_id}/viewform"


def normalize_form_url(raw: str, *, locale_code: Optional[str] = None) -> str:
    value = raw.strip()
    if not value:
        raise ValueError(
            localize_text(
                locale_code,
                "GoogleフォームのURLまたはIDを入力してください。",
                "Please provide the Google Form URL or ID.",
            )
        )

    if value.startswith("http"):
        parsed = urlparse(value)
        if "docs.google.com" not in parsed.netloc:
            raise ValueError(
                localize_text(
                    locale_code,
                    "GoogleフォームのURLを指定してください。",
                    "Please specify a valid Google Forms URL.",
                )
            )
        match = re.search(r"/forms/d/(?:(?P<mode>e)/)?(?P<id>[^/]+)/", parsed.path)
        if not match:
            raise ValueError(
                localize_text(
                    locale_code,
                    "URLからフォームIDを特定できませんでした。",
                    "Unable to determine the form ID from the provided URL.",
                )
            )
        form_id = match.group("id")
        use_e_mode = match.group("mode") == "e"
    else:
        trimmed = value.strip("/ ")
        if "?" in trimmed:
            trimmed = trimmed.split("?", maxsplit=1)[0]
        use_e_mode = True
        if trimmed.startswith("d/e/"):
            use_e_mode = True
            form_id = trimmed.split("/", maxsplit=3)[-1]
        elif trimmed.startswith("e/"):
            use_e_mode = True
            form_id = trimmed.split("/", maxsplit=1)[-1]
        elif trimmed.startswith("d/"):
            use_e_mode = False
            form_id = trimmed.split("/", maxsplit=1)[-1]
        else:
            form_id = trimmed

    return _build_form_url(form_id, use_event_mode=use_e_mode)


def normalize_field_id(raw: str, *, locale_code: Optional[str] = None) -> str:
    value = raw.strip()
    if not value:
        raise ValueError(
            localize_text(
                locale_code,
                "フィールドIDを入力してください。",
                "Please provide the form field ID.",
            )
        )
    return value if value.startswith("entry.") else f"entry.{value}"


def apply_config_updates(
    storage: FormButtonStorage,
    config: FormButtonConfig,
    *,
    user_id: int,
    locale_code: Optional[str],
    form_reference: Optional[str] = None,
    field_id: Optional[str] = None,
    label: Optional[str] = None,
    description: Optional[str] = None,
    button_style: Optional[str] = None,
    embed_title: Optional[str] = None,
) -> FormButtonConfig:
    normalized_url = config.form_url
    if form_reference is not None:
        normalized_url = normalize_form_url(form_reference, locale_code=locale_code)

    normalized_field = config.field_id
    if field_id is not None:
        normalized_field = normalize_field_id(field_id, locale_code=locale_code)

    label_value = config.button_label
    if label is not None:
        sanitized_label = sanitize_optional_text(label)
        label_value = sanitized_label or DEFAULT_BUTTON_LABEL

    description_value = config.description
    if description is not None:
        description_value = sanitize_optional_text(description)

    embed_title_value = config.embed_title
    if embed_title is not None:
        embed_title_value = sanitize_optional_text(embed_title) or DEFAULT_EMBED_TITLE

    style_value = config.button_style
    if button_style is not None:
        style_value = normalize_button_style(button_style, locale_code=locale_code)

    updated = storage.update(
        config.config_id,
        form_url=normalized_url,
        field_id=normalized_field,
        button_label=label_value,
        button_style=style_value,
        description=description_value,
        embed_title=embed_title_value,
        updated_by=user_id,
    )
    return updated


def build_prefilled_url(base_url: str, field_id: str, user_value: str) -> str:
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["usp"] = "pp_url"
    query[field_id] = user_value
    new_query = urlencode(query)
    return urlunparse(parsed._replace(query=new_query))


def style_from_choice(choice: str) -> discord.ButtonStyle:
    try:
        return BUTTON_STYLE_CHOICES[choice]
    except KeyError as exc:
        raise ValueError(
            localize_text(
                None,
                "指定されたボタンスタイルはサポートされていません。",
                "The specified button style is not supported.",
            )
        ) from exc


def ensure_manage_guild(ctx: discord.ApplicationContext) -> bool:
    guild = ctx.guild
    member = ctx.author
    if guild is None or not isinstance(member, discord.Member):
        return False
    return bool(member.guild_permissions.manage_guild)


def build_display_embed(config: FormButtonConfig) -> discord.Embed:
    description = (
        config.description
        or "ボタンを押すとあなた専用のフォームリンクが発行されます。/ Press the button to receive your personalized form link."
    )
    embed = discord.Embed(
        title=config.embed_title,
        description=description,
        colour=discord.Colour.blurple(),
    )
    return embed


class FormButtonView(discord.ui.View):
    def __init__(self, storage: FormButtonStorage, config: FormButtonConfig) -> None:
        super().__init__(timeout=None)
        self.storage = storage
        self.config_id = config.config_id

        button = discord.ui.Button(
            label=config.button_label,
            style=style_from_choice(config.button_style),
            custom_id=config.custom_id,
        )
        button.callback = self._handle_click  # type: ignore[assignment]
        self.add_item(button)

    async def _handle_click(self, interaction: discord.Interaction) -> None:
        config = self.storage.get(self.config_id)
        locale_code = resolve_locale_code(interaction)
        if config is None:
            await interaction.response.send_message(
                localize_text(
                    locale_code,
                    "設定が見つかりません。管理者に連絡してください。",
                    "Configuration not found. Please contact a server administrator.",
                ),
                ephemeral=True,
            )
            return

        target_url = build_prefilled_url(
            config.form_url, config.field_id, str(interaction.user.id)
        )
        embed = discord.Embed(
            title=localize_text(
                locale_code,
                "あなた専用の回答リンク",
                "Your personal response link",
            ),
            description=localize_text(
                locale_code,
                f"[ここを開いてフォームを回答する]({target_url})",
                f"[Open this link to answer the form]({target_url})",
            ),
            colour=discord.Colour.green(),
        )
        embed.set_footer(
            text=localize_text(
                locale_code,
                "リンクはあなたにのみ表示されています",
                "This link is only visible to you.",
            )
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class FormButtonQuickEditModal(discord.ui.Modal):
    def __init__(
        self,
        cog: "FormButtonCog",
        message: discord.Message,
        config: FormButtonConfig,
        locale_code: Optional[str],
    ) -> None:
        title = localize_text(
            locale_code,
            "フォームボタンを素早く編集",
            "Quick edit form button",
        )
        super().__init__(title=title)
        self.cog = cog
        self.message = message
        self.config = config
        self.locale_code = locale_code

        self.form_url_input = discord.ui.TextInput(
            label="GoogleフォームURL / Google Form URL",
            default=config.form_url,
            required=False,
            max_length=512,
        )
        self.field_id_input = discord.ui.TextInput(
            label="フィールドID / Field ID",
            default=config.field_id,
            required=False,
            max_length=64,
        )
        self.label_input = discord.ui.TextInput(
            label="ボタンラベル / Button label",
            default=config.button_label,
            required=False,
            max_length=80,
        )
        self.description_input = discord.ui.TextInput(
            label="説明文 / Description",
            default=config.description or "",
            required=False,
            max_length=200,
            style=discord.TextStyle.paragraph,
        )
        self.embed_title_input = discord.ui.TextInput(
            label="埋め込みタイトル / Embed title",
            default=config.embed_title,
            required=False,
            max_length=100,
        )

        for item in (
            self.form_url_input,
            self.field_id_input,
            self.label_input,
            self.description_input,
            self.embed_title_input,
        ):
            self.add_item(item)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        locale_code = resolve_locale_code(interaction) or self.locale_code
        try:
            updated = apply_config_updates(
                self.cog.storage,
                self.config,
                user_id=interaction.user.id,
                locale_code=locale_code,
                form_reference=self.form_url_input.value,
                field_id=self.field_id_input.value,
                label=self.label_input.value,
                description=self.description_input.value,
                embed_title=self.embed_title_input.value,
            )
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
            return

        view = FormButtonView(self.cog.storage, updated)
        try:
            await self.message.edit(embed=build_display_embed(updated), view=view)
        except discord.HTTPException as exc:
            await interaction.response.send_message(
                localize_text(
                    locale_code,
                    f"メッセージ更新に失敗しました: {exc}",
                    f"Failed to update the message: {exc}",
                ),
                ephemeral=True,
            )
            return

        self.cog.bot.add_view(view, message_id=self.message.id)
        await interaction.response.send_message(
            localize_text(
                locale_code,
                "ボタン設定を更新しました。",
                "Updated the button configuration.",
            ),
            ephemeral=True,
        )


class FormButtonCog(commands.Cog):
    formbutton = discord.SlashCommandGroup(
        "formbutton",
        "Googleフォーム用のボタンを管理します",
        default_member_permissions=discord.Permissions(manage_guild=True),
        contexts=[InteractionContextType.guild],
        integration_types=[IntegrationType.guild_install],
    )

    def __init__(self, bot: discord.Bot, storage: FormButtonStorage) -> None:
        self.bot = bot
        self.storage = storage

    @discord.message_command(
        name="Form Button: Quick Edit",
        contexts=[InteractionContextType.guild],
        integration_types=[IntegrationType.guild_install],
    )
    async def quick_edit_message(
        self, ctx: discord.ApplicationContext, message: discord.Message
    ) -> None:
        locale_code = resolve_locale_code(ctx)

        if not ensure_manage_guild(ctx):
            await ctx.respond(
                localize_text(
                    locale_code,
                    "サーバー管理権限が必要です。",
                    "You need the Manage Server permission to use this command.",
                ),
                ephemeral=True,
            )
            return

        if ctx.guild is None or message.guild is None:
            await ctx.respond(
                localize_text(
                    locale_code,
                    "サーバー内でのみ実行できます。",
                    "This command can only be used inside a server.",
                ),
                ephemeral=True,
            )
            return

        if ctx.guild.id != message.guild.id:
            await ctx.respond(
                localize_text(
                    locale_code,
                    "同一サーバー内のメッセージを指定してください。",
                    "Please select a message from this server.",
                ),
                ephemeral=True,
            )
            return

        config = self.storage.get_by_message_id(message.id)
        if config is None:
            await ctx.respond(
                localize_text(
                    locale_code,
                    "このメッセージには管理対象のボタンがありません。",
                    "This message is not managed by the bot.",
                ),
                ephemeral=True,
            )
            return

        modal = FormButtonQuickEditModal(self, message, config, locale_code)
        await ctx.interaction.response.send_modal(modal)

    @formbutton.command(description="Googleフォームボタンを新規作成します")
    async def create(
        self,
        ctx: discord.ApplicationContext,
        form_reference: Option(
            str,
            "GoogleフォームのURLまたはID / Google Form URL or ID",
            min_length=10,
            max_length=512,
        ),
        field_id: Option(
            str,
            "フォームのフィールドID (entry.xxxxx) / Form field ID",
            min_length=3,
            max_length=64,
        ),
        label: Option(
            str,
            "ボタンに表示するテキスト (1〜80文字) / Button label",
            required=False,
            default=DEFAULT_BUTTON_LABEL,
            min_length=1,
            max_length=80,
        ),
        description: Option(
            str,
            "ボタンの説明文 (最大200文字) / Button description",
            required=False,
            default=None,
            max_length=200,
        ),
        channel: Option(
            discord.TextChannel,
            "ボタンを送信するチャンネル / Target channel (defaults to current)",
            required=False,
            default=None,
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        ),
        button_style: Option(
            str,
            "ボタンカラー (blurple / gray / green / red) / Button color",
            required=False,
            default="blurple",
            autocomplete=button_style_autocomplete,
        ),
        embed_title: Option(
            str,
            "埋め込みタイトル / Embed title",
            required=False,
            default=DEFAULT_EMBED_TITLE,
            min_length=1,
            max_length=100,
        ),
    ) -> None:
        await ctx.defer(ephemeral=True)
        locale_code = resolve_locale_code(ctx)

        if not ensure_manage_guild(ctx):
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "サーバー管理権限が必要です。",
                    "You need the Manage Server permission to use this command.",
                ),
                ephemeral=True,
            )
            return

        if ctx.guild is None:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "サーバー内でのみ実行できます。",
                    "This command can only be used inside a server.",
                ),
                ephemeral=True,
            )
            return

        target_channel = channel or ctx.channel
        if target_channel is None or not isinstance(
            target_channel, discord.TextChannel
        ):
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "テキストチャンネルを指定してください。",
                    "Please choose a text channel.",
                ),
                ephemeral=True,
            )
            return
        if target_channel.guild.id != ctx.guild.id:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "同一サーバー内のチャンネルを指定してください。",
                    "Select a channel from this server.",
                ),
                ephemeral=True,
            )
            return

        try:
            normalized_url = normalize_form_url(form_reference, locale_code=locale_code)
            normalized_field = normalize_field_id(field_id, locale_code=locale_code)
            selected_style = normalize_button_style(
                button_style, locale_code=locale_code
            )
        except ValueError as exc:
            await ctx.followup.send(str(exc), ephemeral=True)
            return

        button_label = sanitize_optional_text(label) or DEFAULT_BUTTON_LABEL
        description_value = sanitize_optional_text(description)
        embed_title_value = sanitize_optional_text(embed_title) or DEFAULT_EMBED_TITLE

        config = self.storage.create(
            guild_id=ctx.guild.id,
            channel_id=target_channel.id,
            message_id=None,
            form_url=normalized_url,
            field_id=normalized_field,
            button_label=button_label,
            button_style=selected_style,
            description=description_value,
            embed_title=embed_title_value,
            author_id=ctx.author.id,
        )

        view = FormButtonView(self.storage, config)
        try:
            message = await target_channel.send(
                embed=build_display_embed(config), view=view
            )
        except discord.HTTPException as exc:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    f"メッセージ送信に失敗しました: {exc}",
                    f"Failed to send the message: {exc}",
                ),
                ephemeral=True,
            )
            return

        self.storage.set_message_id(config.config_id, message.id)
        self.bot.add_view(view, message_id=message.id)
        await ctx.followup.send(
            localize_text(
                locale_code,
                f"<#{target_channel.id}> にボタンを作成しました。",
                f"Created the button in <#{target_channel.id}>.",
            ),
            ephemeral=True,
        )

    @formbutton.command(description="既存のボタン設定を更新します")
    async def edit(
        self,
        ctx: discord.ApplicationContext,
        message_id: Option(
            str,
            "更新対象メッセージのID / Target message ID",
            min_length=17,
            max_length=21,
        ),
        form_reference: Option(
            str,
            "GoogleフォームのURLまたはID / Google Form URL or ID",
            min_length=10,
            max_length=512,
            required=False,
            default=None,
        ),
        field_id: Option(
            str,
            "フォームのフィールドID (entry.xxxxx) / Form field ID",
            min_length=3,
            max_length=64,
            required=False,
            default=None,
        ),
        label: Option(
            str,
            "ボタンに表示するテキスト (1〜80文字) / Button label",
            required=False,
            default=None,
            min_length=1,
            max_length=80,
        ),
        description: Option(
            str,
            "ボタンの説明文 (最大200文字) / Button description",
            required=False,
            default=None,
            max_length=200,
        ),
        button_style: Option(
            str,
            "ボタンカラー (blurple / gray / green / red) / Button color",
            required=False,
            default=None,
            autocomplete=button_style_autocomplete,
        ),
        embed_title: Option(
            str,
            "埋め込みタイトル / Embed title",
            required=False,
            default=None,
            min_length=1,
            max_length=100,
        ),
        channel: Option(
            discord.TextChannel,
            "メッセージがあるチャンネル / Channel containing the message",
            required=False,
            default=None,
            channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        ),
    ) -> None:
        await ctx.defer(ephemeral=True)
        locale_code = resolve_locale_code(ctx)

        if not ensure_manage_guild(ctx):
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "サーバー管理権限が必要です。",
                    "You need the Manage Server permission to use this command.",
                ),
                ephemeral=True,
            )
            return

        if ctx.guild is None:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "サーバー内でのみ実行できます。",
                    "This command can only be used inside a server.",
                ),
                ephemeral=True,
            )
            return

        target_channel = channel or ctx.channel
        if target_channel is None or not isinstance(
            target_channel, discord.TextChannel
        ):
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "テキストチャンネルを指定してください。",
                    "Please choose a text channel.",
                ),
                ephemeral=True,
            )
            return
        if target_channel.guild.id != ctx.guild.id:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "同一サーバー内のチャンネルを指定してください。",
                    "Select a channel from this server.",
                ),
                ephemeral=True,
            )
            return

        try:
            msg_id_int = int(message_id)
        except ValueError:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "メッセージIDは数値で入力してください。",
                    "Message ID must be a number.",
                ),
                ephemeral=True,
            )
            return

        try:
            message = await target_channel.fetch_message(msg_id_int)
        except discord.NotFound:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "指定したメッセージが見つかりません。",
                    "The specified message could not be found.",
                ),
                ephemeral=True,
            )
            return
        except discord.HTTPException as exc:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    f"メッセージ取得に失敗しました: {exc}",
                    f"Failed to fetch the message: {exc}",
                ),
                ephemeral=True,
            )
            return

        config = self.storage.get_by_message_id(message.id)
        if config is None:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    "このメッセージには管理対象のボタンがありません。",
                    "This message is not managed by the bot.",
                ),
                ephemeral=True,
            )
            return

        try:
            updated = apply_config_updates(
                self.storage,
                config,
                user_id=ctx.author.id,
                locale_code=locale_code,
                form_reference=form_reference,
                field_id=field_id,
                label=label,
                description=description,
                button_style=button_style,
                embed_title=embed_title,
            )
        except ValueError as exc:
            await ctx.followup.send(str(exc), ephemeral=True)
            return

        view = FormButtonView(self.storage, updated)
        try:
            await message.edit(embed=build_display_embed(updated), view=view)
        except discord.HTTPException as exc:
            await ctx.followup.send(
                localize_text(
                    locale_code,
                    f"メッセージ更新に失敗しました: {exc}",
                    f"Failed to update the message: {exc}",
                ),
                ephemeral=True,
            )
            return

        self.bot.add_view(view, message_id=message.id)
        await ctx.followup.send(
            localize_text(
                locale_code,
                "ボタン設定を更新しました。",
                "Updated the button configuration.",
            ),
            ephemeral=True,
        )


def register_persistent_views(bot: discord.Bot, storage: FormButtonStorage) -> None:
    for config in storage.all():
        if config.message_id is None:
            continue
        view = FormButtonView(storage, config)
        bot.add_view(view, message_id=config.message_id)


def main() -> None:
    load_dotenv()
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN 環境変数を設定してください。")

    storage = FormButtonStorage(DATA_FILE)
    intents = discord.Intents.none()
    intents.guilds = True
    bot = discord.Bot(intents=intents)
    bot.add_cog(FormButtonCog(bot, storage))

    @bot.event
    async def on_ready() -> None:
        if getattr(bot, "_form_views_registered", False):
            return
        register_persistent_views(bot, storage)
        bot._form_views_registered = True
        logging.info("Logged in as %s", bot.user)

    bot.run(token)


if __name__ == "__main__":
    main()
