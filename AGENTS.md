# Repository boundaries

- MotorcycleHMI is an independent project. Keep its code, tests, build output and deployment in this repository.
- Do not modify or copy implementation files into penpenWeb or other repositories. Portfolio integration is limited to a separately requested showcase entry linking to this game's own repository and deployment.
- Keep public README content focused on the project, controls and setup. Put internal development/release notes in `.local/`, which is ignored by Git.
- Run `npm test` and `npm run build` for relevant changes. Browser tests use this repository's own dependencies.
