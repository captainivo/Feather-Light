"""Feather-Light administrative command line."""

import argparse

import uvicorn

from feather_light.config import Settings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="feather-light")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("serve", help="start the local HTTP service")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    settings = Settings()
    if args.command == "serve":
        uvicorn.run(
            "feather_light.api.app:app",
            host=settings.server.host,
            port=settings.server.port,
            reload=False,
        )


if __name__ == "__main__":
    main()
