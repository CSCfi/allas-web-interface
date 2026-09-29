"""Module containing launchers for the different services."""

import swift_browser_ui.sharing.server
import swift_browser_ui.ui.shell


def run_ui() -> None:
    """Run the UI."""
    swift_browser_ui.ui.shell.main()


def run_sharing() -> None:
    """Run swift-x-account-sharing service."""
    swift_browser_ui.sharing.server.main()


if __name__ == "__main__":
    swift_browser_ui.ui.shell.main()
