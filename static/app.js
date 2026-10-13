// Bootstrap only. Load all static/js modules before this file (see index.html).
verifyEditingInfrastructure();
 applySidebarState();
installDailyLogGuards();
window.addEventListener("pagehide",notifyClientClosed);
window.addEventListener("pageshow",()=>registerClient());
registerClient();
setInterval(heartbeatClient,15000);
document.querySelectorAll(".tabs button[data-tab]").forEach(b=>b.onclick=()=>{if(b.dataset.tab===S.tab||!allowDailyLogNavigation())return;document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");S.tab=b.dataset.tab;S.selected=null;S.selectedKind=null;render()});
initializeApp();
