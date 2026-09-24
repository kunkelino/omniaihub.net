(function(){
  var cloudTimer=null;
  var cloudReady=false;
  function pin(){ return "435777"; }
  function pack(){
    return {
      tasks: window.tasks||[],
      buy: window.buy||[],
      events: window.events||[],
      notes: window.notes||[],
      updatedAt: parseInt(localStorage.getItem("lifehub_updatedAt")||"0",10)||Date.now()
    };
  }
  function saveLocalOnly(){
    try{
      if(window.KEY){
        localStorage.setItem(KEY.tasks,JSON.stringify(window.tasks||[]));
        localStorage.setItem(KEY.buy,JSON.stringify(window.buy||[]));
        localStorage.setItem(KEY.events,JSON.stringify(window.events||[]));
        localStorage.setItem(KEY.notes,JSON.stringify(window.notes||[]));
      }
    }catch(e){}
  }
  function apply(data){
    if(!data) return;
    if(Array.isArray(data.tasks)) window.tasks=data.tasks;
    if(Array.isArray(data.buy)) window.buy=data.buy;
    if(Array.isArray(data.events)) window.events=data.events;
    if(Array.isArray(data.notes)) window.notes=data.notes;
    if(data.updatedAt) localStorage.setItem("lifehub_updatedAt", String(data.updatedAt));
    saveLocalOnly();
    if(typeof renderAll==="function") renderAll();
  }
  window.queueCloudSave=function(){
    if(!cloudReady) return;
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(window.pushCloud, 500);
  };
  window.pushCloud=async function(){
    try{
      var r=await fetch("/api/lifehub-sync",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-lifehub-pin":pin()},
        body:JSON.stringify(pack())
      });
      if(r.ok && typeof toast==="function") toast("Saved to all your devices.");
    }catch(e){}
  };
  window.pullCloud=async function(){
    try{
      var r=await fetch("/api/lifehub-sync",{
        headers:{"x-lifehub-pin":pin()},
        cache:"no-store"
      });
      if(!r.ok){ cloudReady=true; return; }
      var data=await r.json();
      if(data && data.empty){
        cloudReady=true;
        window.pushCloud();
        return;
      }
      var localAt=parseInt(localStorage.getItem("lifehub_updatedAt")||"0",10)||0;
      var cloudAt=parseInt((data && data.updatedAt)||0,10)||0;
      if(cloudAt>localAt){
        apply(data);
        if(typeof toast==="function") toast("Loaded from your other device.");
      } else if(localAt>cloudAt){
        cloudReady=true;
        window.pushCloud();
        return;
      }
      cloudReady=true;
    }catch(e){
      cloudReady=true;
    }
  };
})();
