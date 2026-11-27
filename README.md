# diff-speed-akun1

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Tigapandax/diff-speed-akun1/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Tigapandax/diff-speed-akun1/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A fast drop-in for makefun-diff 1.0.0: Myers's greedy line diff with the reference's exact tie-break (deletion wins a tie, no edge-diagonal pruning), implemented over interned line ids in a single flat typed-array buffer. On the kit's practice set it reproduces makefun-diff's patch byte for byte on all 4 cases, and runs the 4 cases in ~705 ms (median) versus ~1,317 ms for the house baseline — about 1.9x faster on this machine.

## Run it

```sh
node main.ts
```

The harness runs `node /bot/main.ts`: it reads every case from `/input/cases.json`, answers each with `run()` from `solve.js`, and writes `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`. Node 22, no dependencies, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ez8ygcr2&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
