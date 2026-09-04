# Murugesan Electrical and Hardwares

The approved React storefront remains in `src/App.tsx` and its existing CSS. Catalog data is now served by the API rather than written back to browser storage.

## Local development

Node 24 is required because the API uses the built-in `node:sqlite` runtime module.

```bash
npm run dev:api
npm run dev
```

The Vite server proxies `/api` and `/uploads` to `http://localhost:8787`. The seeded admin is configured by `ADMIN_EMAIL` and `ADMIN_PASSWORD`; use `.env.example` as the starting point and change the password before deployment.

## Architecture

- `server/schema.sql` defines users, hierarchical categories, brands, product types, dynamic attributes, products, and import jobs.
- `server/index.cjs` provides authentication, catalog reads, server-side product pagination/search, protected product/category writes, archive actions, image uploads, dashboard stats, and a transactional legacy migration endpoint.
- Product relationships use `category_id`, `brand_id`, and `product_type_id`; dynamic values are stored as JSON alongside attribute definitions.
- Product images are stored as files under the configured upload directory and products retain URLs, never Base64 image data.
- `src/App.tsx` loads the public catalog from `/api/catalog` and uses a JWT stored only for the admin session. Existing presentation components and styles are preserved.

## Legacy migration

Authenticate as an admin, then POST the old `murugesan-categories` and `murugesan-products` JSON values to `/api/migration/legacy` as `{ "categories": [], "products": [] }`. The endpoint uses `INSERT OR IGNORE`, maps category and brand relationships, and runs in a transaction. It is intentionally not an automatic destructive localStorage migration.

## Current limitations

The existing admin bulk-import and category screens still need to be moved from in-memory callbacks to the protected import/category APIs. The customer product view currently receives the catalog bootstrap payload; the paginated `/api/products` endpoint is available for the next UI slice. Orders, payments, object-storage image transforms, and background import workers are not implemented yet.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
