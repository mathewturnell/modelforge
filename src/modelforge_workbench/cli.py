"""Supported public-alpha command line."""

from __future__ import annotations

import argparse
import json
import sys
import sysconfig
from pathlib import Path

from . import __version__
from .alpha import AlphaWorkbench
from .application.example_setup import ExampleSetupService
from .contracts.project_capabilities import project_capabilities
from .project_manifest import ProjectManifestCompatibilityError, load_project_manifest
from .workbench import serve


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="modelforge", description="ModelForge public alpha")
    parser.add_argument("--version", action="version", version=f"ModelForge {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    project = commands.add_parser("project", help="Inspect a project without executing it")
    project_commands = project.add_subparsers(dest="project_command", required=True)
    capabilities = project_commands.add_parser("capabilities", help="Show authored static capabilities")
    capabilities.add_argument("--manifest", type=Path, required=True)
    register = project_commands.add_parser("register", help="Register private local runtime configuration")
    register.add_argument("--state-root", type=Path, required=True)
    register.add_argument("--config", type=Path, required=True)
    project_list = project_commands.add_parser("list", help="List registered local projects")
    project_list.add_argument("--state-root", type=Path, required=True)

    demo = commands.add_parser("demo", help="Run the bundled offline example")
    demo_commands = demo.add_subparsers(dest="demo_command", required=True)
    demo_run = demo_commands.add_parser("run", help="Create and finish one managed run")
    demo_run.add_argument("--state-root", type=Path, required=True)
    demo_run.add_argument("--executor", choices=("local", "modal"), default="local")
    demo_run.add_argument("--modal-environment")
    demo_run.add_argument("--confirm-billable", action="store_true")
    demo_recover = demo_commands.add_parser(
        "recover-modal", help="Recover one unfinished Modal function call",
    )
    demo_recover.add_argument("--state-root", type=Path, required=True)
    demo_recover.add_argument("--run-id", required=True)
    demo_recover.add_argument("--modal-environment", required=True)
    demo_recover.add_argument("--confirm-billable", action="store_true")

    modal = commands.add_parser("modal", help="Inspect optional Modal readiness")
    modal_commands = modal.add_subparsers(dest="modal_command", required=True)
    modal_status = modal_commands.add_parser("status")
    modal_status.add_argument("--environment", required=True)

    runs = commands.add_parser("runs", help="Inspect bundled-example run history")
    run_commands = runs.add_subparsers(dest="runs_command", required=True)
    run_list = run_commands.add_parser("list")
    run_list.add_argument("--state-root", type=Path, required=True)
    run_list.add_argument("--project")

    action = commands.add_parser("action", help="Run a registered local project action")
    action_commands = action.add_subparsers(dest="action_command", required=True)
    action_run = action_commands.add_parser("run")
    action_run.add_argument("--state-root", type=Path, required=True)
    action_run.add_argument("--project", required=True)
    action_run.add_argument("--request", type=Path, required=True)

    browser = commands.add_parser("serve", help="Start the loopback workbench")
    browser.add_argument("--state-root", type=Path)
    browser.add_argument("--port", type=int, default=8000)
    browser.add_argument("--no-browser", action="store_true")
    examples = commands.add_parser("examples", help="Inspect and explicitly prepare examples")
    example_commands = examples.add_subparsers(dest="examples_command", required=True)
    example_commands.add_parser("path")
    setup = example_commands.add_parser(
        "setup", help="Plan or explicitly perform external example setup",
    )
    setup_commands = setup.add_subparsers(dest="setup_command", required=True)

    def setup_arguments(command: argparse.ArgumentParser, *, mutable: bool = False) -> None:
        command.add_argument("--example", required=True)
        command.add_argument("--external-root", type=Path, required=True)
        command.add_argument(
            "--use", action="append", default=[], metavar="ID=ABSOLUTE_PATH",
            help="Use an existing checkout, dataset, or model cache",
        )
        if mutable:
            command.add_argument(
                "--confirm", action="store_true",
                help="Perform the described operation after reviewing its plan",
            )

    setup_arguments(setup_commands.add_parser("plan"))
    fetch = setup_commands.add_parser("fetch")
    setup_arguments(fetch, mutable=True)
    fetch.add_argument("--only", action="append", default=[], metavar="ID")
    install = setup_commands.add_parser("install")
    setup_arguments(install, mutable=True)
    install.add_argument(
        "--install-requirements", action="store_true",
        help="Install the reviewed requirements file into the isolated environment",
    )
    return parser


def _examples_root() -> Path:
    installed = Path(sysconfig.get_path("data")) / "share" / "modelforge" / "examples"
    if installed.is_dir():
        return installed
    source_checkout = Path(__file__).resolve().parents[2] / "examples"
    return source_checkout if source_checkout.is_dir() else installed


def _setup_bindings(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        item_id, separator, raw_path = value.partition("=")
        if not separator or not item_id or not raw_path:
            raise ValueError("Existing setup bindings must use ID=ABSOLUTE_PATH")
        if item_id in result:
            raise ValueError(f"Existing setup binding was repeated: {item_id}")
        result[item_id] = Path(raw_path)
    return result


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "project" and args.project_command == "capabilities":
            value = project_capabilities(load_project_manifest(args.manifest))
        elif args.command == "project" and args.project_command == "register":
            value = AlphaWorkbench(args.state_root).register_project(args.config)
        elif args.command == "project":
            value = {"projects": AlphaWorkbench(args.state_root).list_projects()}
        elif args.command == "demo" and args.demo_command == "run":
            value = AlphaWorkbench(args.state_root).run_example(
                executor=args.executor,
                modal_environment=args.modal_environment,
                billable_confirmed=args.confirm_billable,
            )
        elif args.command == "demo":
            value = AlphaWorkbench(args.state_root).recover_modal_example(
                args.run_id,
                modal_environment=args.modal_environment,
                billable_confirmed=args.confirm_billable,
            )
        elif args.command == "modal":
            value = AlphaWorkbench.modal_status(args.environment)
        elif args.command == "runs":
            value = {"runs": AlphaWorkbench(args.state_root).list_runs(args.project)}
        elif args.command == "action":
            payload = json.loads(args.request.read_text(encoding="utf-8"))
            app = AlphaWorkbench(args.state_root)
            execution = app.start_project_action(args.project, payload)
            value = app.finish_project_action(execution)
        elif args.command == "examples" and args.examples_command == "path":
            value = {"path": str(_examples_root())}
        elif args.command == "examples":
            service = ExampleSetupService(_examples_root())
            bindings = _setup_bindings(args.use)
            if args.setup_command == "plan":
                value = service.plan(args.example, args.external_root, use=bindings)
            elif args.setup_command == "fetch":
                value = service.fetch(
                    args.example,
                    args.external_root,
                    use=bindings,
                    selected=args.only,
                    confirmed=args.confirm,
                )
            else:
                if bindings:
                    raise ValueError(
                        "--use applies to plan/fetch; dependency installation uses the isolated environment",
                    )
                value = service.install(
                    args.example,
                    args.external_root,
                    confirmed=args.confirm,
                    install_requirements=args.install_requirements,
                )
        else:
            serve(
                state_root=args.state_root,
                port=args.port,
                open_browser=not args.no_browser,
            )
            return 0
    except (KeyError, OSError, ProjectManifestCompatibilityError, RuntimeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
