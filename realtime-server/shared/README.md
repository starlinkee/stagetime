Shared types/constants/physics for the realtime server and the Next.js client.

This lives under `realtime-server/` (not at the repo root) purely to keep the Fly.io Docker
build context simple — everything the server's Dockerfile needs is already inside
`realtime-server/`. The Next.js app imports these files by relative path from
`src/components/RoomStage.tsx`; Vercel builds from the full repo tree so that's not a problem
on that side.

If this project ever moves to real npm workspaces, this folder is the one to promote to a
top-level `/shared` package (see docs/stateful_server_plan.md, open question 3).
