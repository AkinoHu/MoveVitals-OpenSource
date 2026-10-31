import { migrate } from "../src/lib/db";

migrate()
  .then(() => {
    console.log("migrations applied");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
