import { buildApp } from "./app";
import { Store } from "../db/store";

const app = buildApp({
  store: new Store(process.env.DB_PATH ?? "data.db"),
  oauth: {
    clientId: process.env.SUUNTO_CLIENT_ID ?? "",
    clientSecret: process.env.SUUNTO_CLIENT_SECRET ?? "",
    redirectUri: process.env.SUUNTO_REDIRECT_URI ?? "http://localhost:3000/oauth/callback",
    subscriptionKey: process.env.SUUNTO_SUBSCRIPTION_KEY ?? "",
  },
  subscriptionKey: process.env.SUUNTO_SUBSCRIPTION_KEY ?? "",
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port}`));
