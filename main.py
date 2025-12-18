from __future__ import annotations

import asyncio
import logging
import os

import discord

from offkai_manager.config import load_config
from offkai_manager.nocodb_api import NocoDbClient, NocoDbConfig
from offkai_manager.nocodb_repo import NocoDbIds, OffkaiNocoDbRepo
from offkai_manager.offkai import OffkaiCog, register_persistent_views

_LOG_LEVEL = (os.environ.get("LOG_LEVEL") or "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    force=True,
)
log = logging.getLogger(__name__)

# httpx/httpcore are very chatty at INFO; keep them quiet unless explicitly debugging.
if _LOG_LEVEL != "DEBUG":
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


async def async_main() -> None:
    config = load_config()

    nocodb = NocoDbClient(
        config=NocoDbConfig(
            base_url=config.nocodb_base_url,
            token=config.nocodb_token,
            base_id=config.nocodb_base_id,
        )
    )
    repo = OffkaiNocoDbRepo(
        client=nocodb,
        ids=NocoDbIds(
            base_id=config.nocodb_base_id,
            table_event=config.nocodb_table_event,
            table_panel=config.nocodb_table_panel,
            table_registration=config.nocodb_table_registration,
            table_member=config.nocodb_table_member,
        ),
    )

    intents = discord.Intents.none()
    intents.guilds = True
    intents.members = True

    bot = discord.Bot(intents=intents)
    bot.add_cog(OffkaiCog(bot, repo=repo))

    @bot.event
    async def on_ready() -> None:
        if getattr(bot, "_offkai_views_registered", False):
            return
        await register_persistent_views(bot, repo=repo)
        setattr(bot, "_offkai_views_registered", True)
        log.info("Logged in as %s", bot.user)

    try:
        await bot.start(config.discord_bot_token)
    finally:
        await nocodb.aclose()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
