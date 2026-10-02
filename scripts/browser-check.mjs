import fs from "node:fs";
import {execSync} from "node:child_process";
let found=[];
for(const cmd of ["chromium","chromium-browser","google-chrome","google-chrome-stable"]){
  try{const p=execSync("command -v "+cmd,{encoding:"utf8"}).trim();if(p)found.push(cmd+"="+p);}catch{}
}
const name=found.length?"browser-present-"+found.map(x=>x.split("=")[0]).join("-")+".html":"browser-missing.html";
fs.writeFileSync(name,"<!doctype html><pre>"+JSON.stringify({found},null,2)+"</pre>");
console.log("BROWSER_CHECK",found);
