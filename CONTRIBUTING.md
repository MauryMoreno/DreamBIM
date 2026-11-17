# Contributing to DreamBIM

Thanks for your interest in DreamBIM. Bug reports, ideas and pull requests are welcome.

## Before you start

- For a bug, open an issue with the steps to reproduce it, what you expected and what happened. Attach a small `.ifcx` file if the problem depends on a model.
- For a new feature or a large change, open an issue first so that we can agree on the approach before you write the code.

## Set up

Follow the requirements and the usage steps in the [README](README.md). Read the [architecture guide](docs/architecture.md) before you change `studio/src/`: it explains the layers and the patterns the code uses.

## Rules for a pull request

- Keep each pull request on one topic.
- Add or update tests for every change in behavior.
- Write code, comments, test titles and interface text in English, using the terms of Revit.
- Keep each file under 400 lines. `studio/test/architecture.test.ts` and `studio/test/conventions.test.ts` check the layers and the conventions.
- Run all the checks before you push:

  ```sh
  cd studio && npm run typecheck && npm test && npm run knip
  cd studio/src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
  cd converter && .venv/Scripts/python -m pytest tests
  ```

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
