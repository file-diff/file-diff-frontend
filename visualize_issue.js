// Visualize the rendering issue

const diff = {
  left: [
    { path: "cmd", status: "same" },
    { path: "cmd/golembase", status: "removed" },
    { path: "common", status: "same" },
    { path: "cmd/golembase/main.go", status: "removed" },
    { path: "common/helper.txt", status: "same" },
  ],
  right: [
    { path: "cmd", status: "same" },
    null,
    { path: "common", status: "same" },
    null,
    { path: "common/helper.txt", status: "same" },
  ]
};

console.log("Rendered output (side by side):\n");
console.log("LEFT COLUMN                          | RIGHT COLUMN");
console.log("====================================== | ======================================");

for (let i = 0; i < diff.left.length; i++) {
  const left = diff.left[i];
  const right = diff.right[i];
  
  const leftStr = left ? `${left.path} (${left.status})` : "[EMPTY]";
  const rightStr = right ? `${right.path} (${right.status})` : "[EMPTY]";
  
  const indent = (path) => path ? " ".repeat((path.match(/\//g) || []).length * 2) : "";
  
  const leftDisplay = left ? indent(left.path) + left.path.split('/').pop() : "[EMPTY]";
  const rightDisplay = right ? indent(right.path) + right.path.split('/').pop() : "[EMPTY]";
  
  console.log(`${leftDisplay.padEnd(35)} | ${rightDisplay}`);
}
