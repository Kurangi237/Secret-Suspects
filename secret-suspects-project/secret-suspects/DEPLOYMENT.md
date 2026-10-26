# Public deployment checklist

The source package is prepared for Netlify, but it has **not** been published from this environment.

1. In a network-enabled environment, run `npm install` at the project root and commit the generated `package-lock.json`.
2. Push the project to a Git provider, or deploy it using a Netlify CLI session authenticated to the Netlify account you control.
3. Create/import a Netlify site and confirm the build settings match `netlify.toml`.
4. Confirm the function appears at `/.netlify/functions/game` after deploy.
5. Open the public URL in at least three separate browser profiles/devices.
6. Test create/join, investigator-vs-impostor secret isolation, chat, voting, ties, win conditions, disconnect grace, host transfer, rematch, and mobile layout.
7. Inspect function logs and fix any runtime or Blobs authorization issues before submitting the URL.

Do not share Netlify tokens, API keys, or private session values in chat or commit them to the project.
