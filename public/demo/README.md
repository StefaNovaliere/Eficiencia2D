# Demo Folder

Place a demo `.obj` file here named **`demo.obj`** to enable the "Ver demo"
button on the home page.

## How it works

1. The user clicks the floating "¿Querés ver cómo funciona?" button.
2. The app fetches `/demo/demo.obj` (served from this folder by Next.js).
3. The file is loaded into the normal pipeline (review screen → nesting →
   payment), letting a new visitor see the full flow without uploading
   their own model.

## File requirements

- Format: `.obj` (Wavefront)
- Should contain a small, recognizable building (a few walls, a floor, maybe
  a roof) so the classification step demonstrates clearly what the app does.
- Keep it small (under 1 MB) so the page loads quickly.

If `demo.obj` is not present, the demo button will show a friendly error
instead of breaking the app.
