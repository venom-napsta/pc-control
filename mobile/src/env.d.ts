// Babel substitutes EXPO_PUBLIC_* at build time, so these are the only members
// of `process` that exist in the app bundle. Declaring them narrowly rather
// than pulling in @types/node keeps the rest of Node's API — which is absent
// on device — out of reach.
declare const process: {
  env: {
    EXPO_PUBLIC_SERVERS?: string;
    EXPO_PUBLIC_SERVER?: string;
    NODE_ENV?: string;
  };
};
