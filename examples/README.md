# Cocos Hybrid integration samples

The repository maintains one Hybrid integration sample for each supported
Creator generation. Each project opens directly in Creator and installs
`@truewatchtech/cocos-sdk` from `file:../../packages/cocos`.

| Project | Creator version | Instructions |
| --- | --- | --- |
| `hybrid-creator2/` | 2.4.15 | [Creator 2 setup and validation](hybrid-creator2/README.md) |
| `hybrid-creator3/` | 3.8.8 | [Creator 3 setup and validation](hybrid-creator3/README.md) |

Both projects demonstrate the same integration flow: the native host starts
the SDK, opens Cocos, then receives RUM View and Session Replay ownership when
the user returns to the native page. Buttons validate RUM Actions and Errors,
linked Logs, automatic network collection, manual Trace/Resource collection,
Replay visual changes, and privacy masking.

Creator-specific code covers engine APIs, Android lifecycle differences, and
Replay camera/layout checks. SDK bridges and build extensions are installed
by each project's `npm run setup` command.

## Configure and run

Follow the matching project's README for `setup`, `configure`, Creator build,
and `native:install`. Credentials are generated from `SAMPLE_*` environment
variables into ignored files under that project's `native-host/` directory.

From the repository root, `npm run sample:configure` configures Creator 3 by
default. To configure Creator 2 from the root, use:

```bash
npm run sample:configure -- --native-host-dir examples/hybrid-creator2/native-host
```

Hybrid validation requires an Android or iOS build. Editor/browser preview
does not have a native SDK instance to attach to.

Diagnostic games, copied SDK installations, Replay traffic benchmarks, and
synthetic Replay upload tools are excluded from the maintained samples. Local
copies are ignored by Git.
