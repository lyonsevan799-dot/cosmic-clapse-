<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Present one arena gameplay mode; preserve legacy save fields while recording arena achievements and lifetime statistics so old progress survives migration.
- Reuse the existing Canvas object physics for bots; arena helpers stay in src/game/arena.ts to keep AI rules testable without UI.
- Share frame-rate independent steering and growth rules between human and opponents so gameplay remains fair and tunable internally.
- Package standalone exports from a temporary Vite client entry that mounts the existing game, leaving TanStack Start routing and deployment unchanged.
- Keep respawn geometry and sparse-grid bounds in pure arena helpers; use asymptotic camera zoom and guarded rendering so late-game stability never depends on reducing player mass.
