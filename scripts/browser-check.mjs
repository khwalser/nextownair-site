import {execSync} from "node:child_process";
let found=[];
for(const cmd of ["chromium","chromium-browser","google-chrome","google-chrome-stable"]){
  try{const p=execSync("command -v "+cmd,{encoding:"utf8"}).trim();if(p)found.push(cmd+"="+p);}catch{}
}
console.log("BROWSER_CHECK",found);
if(!found.length){
  console.error("NO_BROWSER_AVAILABLE");
  process.exit(23);
}
