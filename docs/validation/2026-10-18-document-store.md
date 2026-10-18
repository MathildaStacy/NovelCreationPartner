# Native document store validation · 2026-10-18

The export/import boundary is implemented in `src/files/index.ts`, `NativeDocumentStore.ts`, Android `DocumentStoreModule.kt`, and iOS `DocumentStore.mm`. It accepts document names and base64 content, never caller-provided filesystem paths. The JavaScript and native boundaries enforce a 50 MiB content limit. Export MIME types are allowlisted; filenames remove path separators and control characters.

Android uses the system `ACTION_OPEN_DOCUMENT` picker and reads only the returned `content:` URI with bounded streaming. Export writes a unique app-cache subdirectory and opens the system share chooser using `FileProvider`, a narrow cache path, and explicit read grants. Exports belong to a process-wide UUID session. Startup cleanup removes previous-process sessions, including legacy files, while preserving the current process; a React reload cannot delete a file still used by a share target. No broad filesystem permission was added.

iOS uses `UIDocumentPickerViewController` with copied documents and security-scoped access during a bounded stream read. Export uses `UIActivityViewController` on the foreground UI, a unique protected cache file, and deferred cleanup at the next process startup. Completion and module invalidation keep files already handed to the system. Picker cancellation returns null. Module invalidation settles pending UI ownership; no local file path crosses the JavaScript boundary.

Evidence from this session:

- Before the D07 result/cleanup follow-up, `source scripts/dev-env.sh && ./android/gradlew -p android :app:compileDebugKotlin --console=plain` passed after the final Android changes. This compiled generated code, module registration, resources, and Kotlin; it is not a device picker/share test.
- React Native iOS code generation passed, and generated `NativeDocumentStoreSpec` method signatures match the Objective-C++ module.
- File-port tests passed for sanitized names, MIME allowlists, invalid base64, picker cancellation, and path exclusion.
- iOS compilation could not run: the selected developer directory is `/Library/Developer/CommandLineTools`; `xcrun --sdk iphonesimulator --show-sdk-path` reports no iPhone simulator SDK.

Remaining device verification: foreground picker cancellation/success, large documents near the limit, cloud-document providers, recipient access to shared files, iPad popover behavior, app background/termination while a picker/share sheet is open, and iOS compile/link with a full Xcode SDK. No mock or codegen result is claimed as those device results.


Native boundary audit follow-up:

- Apple Foundation was exercised directly with the same `JSONSerialization` options used by the iOS module. Default JSON slash escaping doubled a slash-heavy base64 payload: a 27 MiB input produced 75,497,511 JSON characters and exceeded the JavaScript 69,909,164-character bound despite the content being below 50 MiB.
- DocumentStore and CoverStore JSON output now use `NSJSONWritingWithoutEscapingSlashes` (available before the project deployment target iOS 15.1). A real Foundation round-trip with a 120-character filename produced 37,748,879 characters for 27 MiB and 69,905,211 for exactly 50 MiB; both fit the JavaScript bound and decoded byte-for-byte. No slash escapes remained. This verifies Foundation encoding and the calculated boundary, not an iOS picker or React Native device transfer.
- Read-only review found no caller-controlled native filesystem path input, cover token traversal, or operation that overwrites the prior cover before the SQLite reference commit. Native image processing writes a new private UUID file; file export exposes only the narrow cache FileProvider root. The remaining device lifecycle, low-memory and cloud-provider checks above are still outstanding; a byte-size cap is not a measured peak-memory guarantee.

D07 result/cleanup follow-up:

- iOS returns `completed` only for the actual activity completion flag, and `cancelled` otherwise. Android returns `opened` after successful chooser launch; the UI never claims that an Android target saved a file. Unknown native result values fail explicitly.
- `cleanupExports()` has no path input and is an independent startup step. Each process owns one session directory; current-session files survive cancellation, completion, repeated cleanup, and React reload. Preparation/launch failures remove only the failed export. New app processes remove prior sessions.
- Directory creation and file writes preserve native `ENOSPC` / `EDQUOT` (and iOS Cocoa out-of-space) as `STORAGE_FULL`. Export UI shows the specified storage message without treating it as an ordinary database failure.
- Names include the work, chapter number/title or extra marker as applicable; portable replacements use `-`, filenames are bounded to 80 Unicode code points / 255 UTF-8 bytes with the extension retained, and backup timestamps use YYYYMMDD-HHmm. Native filename bounds now count surrogate pairs as one code point.
- Focused JavaScript checks: TypeScript and targeted ESLint passed; file-port, startup maintenance, export/restore UI suites passed (3 suites / 23 tests). These exercise injected ports, filenames and UI state only, not native share completion, actual disk exhaustion or recipient delayed reading. Final native build evidence is recorded by the coordinating agent after code generation.

Final stage Android integration: `source scripts/dev-env.sh && ./android/gradlew -p android :app:assembleDebug --console=plain` passed, producing the Debug APK with the document/cover/AppInfo modules registered. Logs: `/tmp/novel-e-assemble.log`, `/tmp/novel-e-assemble-final.log`. iOS code generation also passed (`/tmp/novel-e-codegen.log`). This verifies Android compile/link/package and bridge generation, not device file/image/share interaction or an iOS build.
