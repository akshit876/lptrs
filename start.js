const { exec } = require("child_process");

console.log("Starting Backend...");
const backendProcess = exec("npm run dev:backend");

setTimeout(() => {
  console.log("Starting Frontend after 10 seconds...");
  exec("npm run dev:frontend");
}, 10000);
