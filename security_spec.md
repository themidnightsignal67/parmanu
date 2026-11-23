# Brahmand Firestore Security Specification

## 1. Data Invariants
1. Every document in `/users/{userId}` can only be read, created, or updated by the verified Google user whose `request.auth.uid == userId`, with `credits` strictly bounded `[0, 1000]` and no self-assigned admin fields.
2. Every document in `/investigations/{scanId}` MUST have `ownerId == request.auth.uid` on create, `collaboratorEmails` bounded `<= 10`, and can only be read (`get`/`list`) by the owner or a verified user whose `request.auth.token.email` is inside `collaboratorEmails`.
3. Only the owner can delete an investigation or modify `collaboratorEmails`; collaborators cannot hijack `ownerId` or alter immutable timestamps (`createdAt`).
4. Every document in `/monitors/{ruleId}`, `/snapshots/{snapshotId}`, and `/teamMembers/{memberId}` is strictly private to `ownerId == request.auth.uid` on get, list, create, update, and delete.
5. All string fields enforce explicit `.size()` bounds and ID path variables pass `isValidId()`.
6. All `createdAt` and `updatedAt` timestamps must match `request.time`, and `createdAt`/`ownerId` are immutable on updates.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/users/uid1` -> denied by global default-deny and `isVerifiedUser()`.
2. Unverified email (`email_verified: false`) attempting write to `/investigations/scan_1` -> denied by `request.auth.token.email_verified == true`.
3. Non-owner reading `/users/other_uid` -> denied by `request.auth.uid == userId`.
4. User creating `/users/uid1` with shadow key `isAdmin: true` -> denied by `keys().hasOnly(...)`.
5. User updating `/users/uid1` with `credits: 999999` -> denied by `credits <= 1000`.
6. User creating `/investigations/bad$id!` with invalid path ID -> denied by `isValidId(scanId)`.
7. User creating `/investigations/scan_1` with `ownerId: "victim_uid"` -> denied by `incoming().ownerId == request.auth.uid`.
8. User creating `/investigations/scan_1` with client-forged `createdAt` instead of `request.time` -> denied.
9. User updating `/investigations/scan_1` and attempting to mutate `ownerId` or `createdAt` -> denied by immutability checks and `affectedKeys().hasOnly(...)`.
10. User adding 15 collaborator emails to `collaboratorEmails` -> denied by `collaboratorEmails.size() <= 10`.
11. Blanket `list` query on `/monitors` without `where('ownerId', '==', uid)` -> denied by `resource.data.ownerId == request.auth.uid`.
12. Non-owner attempting to read `/snapshots/snap_1` -> denied by `resource.data.ownerId == request.auth.uid`.
