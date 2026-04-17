import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { installTreeXNativePatches } from "./src/treex-component.js";

export default function treeXExtension() {
  installTreeXNativePatches(InteractiveMode);
}
