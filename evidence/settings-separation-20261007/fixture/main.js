const {Plugin}=require('obsidian'); module.exports=class extends Plugin { onload(){window.__managerToggleFixtureLoads=(window.__managerToggleFixtureLoads||0)+1;} };
