#!/bin/sh
# One image, two Railway services: MV_ROLE=worker runs the background worker,
# anything else serves the web app.
if [ "$MV_ROLE" = "worker" ]; then
  exec pnpm worker
else
  exec pnpm exec next start
fi
