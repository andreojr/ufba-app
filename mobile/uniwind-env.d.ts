/// <reference types="uniwind/types" />

// TypeScript 6 (SDK 57) rejects a side-effect import of a file it has no
// declaration for — `import "../global.css"` in app/_layout.tsx. Uniwind ships
// no `*.css` declaration of its own, so this is ours.
declare module "*.css";
