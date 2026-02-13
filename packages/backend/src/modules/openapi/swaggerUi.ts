export const renderSwaggerUi = (
  title: string,
  specUrl: string,
  initScriptUrl = './swagger-ui-init.js',
) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
  </head>
  <body>
    <p style="font-family: sans-serif; margin: 12px 16px; color: #333;">
      If Swagger UI is blank, open the raw spec at
      <a href="${specUrl}" target="_blank" rel="noreferrer">${specUrl}</a>.
    </p>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="${initScriptUrl}?url=${encodeURIComponent(specUrl)}"></script>
  </body>
</html>`;

export const renderSwaggerUiInitScript = () =>
  `(function(){
  var script=document.currentScript;
  var url='./openapi.json';
  try {
    var parsed=new URL(script.src);
    url=parsed.searchParams.get('url')||url;
  } catch(e) {}

  var container=document.getElementById('swagger-ui');
  var showFallback=function(message){
    if(!container){return;}
    fetch(url)
      .then(function(res){return res.text();})
      .then(function(text){
        var note=document.createElement('div');
        note.style.fontFamily='monospace';
        note.style.fontSize='12px';
        note.style.color='#b42318';
        note.style.margin='12px 16px';
        note.textContent=message;

        var pre=document.createElement('pre');
        pre.style.whiteSpace='pre-wrap';
        pre.style.wordBreak='break-word';
        pre.style.background='#f6f8fa';
        pre.style.border='1px solid #d0d7de';
        pre.style.borderRadius='6px';
        pre.style.padding='12px';
        pre.style.margin='12px 16px';
        pre.textContent=text;

        container.innerHTML='';
        container.appendChild(note);
        container.appendChild(pre);
      })
      .catch(function(err){
        if(!container){return;}
        container.innerHTML='';
        var msg=document.createElement('div');
        msg.style.fontFamily='sans-serif';
        msg.style.color='#b42318';
        msg.style.margin='12px 16px';
        msg.textContent='Swagger UI failed to load and raw spec fetch failed: '+String(err && err.message ? err.message : err);
        container.appendChild(msg);
      });
  };

  if(typeof window.SwaggerUIBundle !== 'function'){
    showFallback('Swagger UI bundle is unavailable. Showing raw OpenAPI spec instead.');
    return;
  }

  try {
    window.ui=window.SwaggerUIBundle({
      url:url,
      dom_id:'#swagger-ui',
      deepLinking:true,
      presets:[window.SwaggerUIBundle.presets.apis],
    });
  } catch(err){
    showFallback('Swagger UI initialization failed. Showing raw OpenAPI spec instead.');
  }
})();`;
