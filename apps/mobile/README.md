# Contractor app (Expo)

Not scaffolded yet. Phase 1 (Foundation) is database-only; the Expo app is
created in Phase 2 per CLAUDE.md "Build order".

When it is scaffolded:

- Expo (React Native, TypeScript) with expo-router
- A custom Expo native module for background multipart uploads to R2
  (PRD "Footage pipeline → How an upload works")
- Only `EXPO_PUBLIC_*` values in the bundle — no server keys (CLAUDE.md rule 4)
