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
  function seedIfEmpty(){
    var tasksEmpty=!window.tasks || !window.tasks.length;
    var buyEmpty=!window.buy || !window.buy.length;
    if(!tasksEmpty && !buyEmpty) return false;
    var today=new Date();
    var due=[today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-");
    function id(){ return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()); }
    if(tasksEmpty){
      window.tasks=["Build portfolio","Work on Speak4","Work on RAP"].map(function(title){
        return {id:id(),title:title,due:due,notes:"",done:false};
      });
    }
    if(buyEmpty){
      window.buy=["Locker organizer","Bag for pajamas","Shampoo","Water bottle","Bluetooth earbuds","Phone case","Charging cable","Wall charger","CapCut Pro","$20 for B cards","2 protective hard glasses cases"].map(function(item){
        return {id:id(),item:item,price:"",notes:"",bought:false};
      });
    }
    localStorage.setItem("lifehub_updatedAt", String(Date.now()));
    saveLocalOnly();
    if(typeof renderAll==="function") renderAll();
    return true;
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
      if(!r.ok){ seedIfEmpty(); cloudReady=true; return; }
      var data=await r.json();
      if(data && data.empty){
        seedIfEmpty();
        cloudReady=true;
        window.pushCloud();
        return;
      }
      var localAt=parseInt(localStorage.getItem("lifehub_updatedAt")||"0",10)||0;
      var cloudAt=parseInt((data && data.updatedAt)||0,10)||0;
      if(cloudAt>=localAt){
        apply(data);
        if(seedIfEmpty()) window.pushCloud();
        if(typeof toast==="function") toast("Loaded from your other device.");
      } else {
        cloudReady=true;
        if(seedIfEmpty()) window.pushCloud();
        else window.pushCloud();
        return;
      }
      cloudReady=true;
    }catch(e){
      seedIfEmpty();
      cloudReady=true;
    }
  };
})();
