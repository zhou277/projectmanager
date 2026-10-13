// projectmanager 3.21.0 — util
// Classic script: shared globals preserve existing HTML event handlers.
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

function markdownInline(source){
  let text=String(source??"");
  const codeSpans=[];
  text=text.replace(/`([^`]+)`/g,(_,code)=>{
    const key=`@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${esc(code)}</code>`);
    return key;
  });

  text=esc(text);

  text=text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(m,label,url)=>{
    const decoded=String(url).replace(/&amp;/g,"&").trim();
    if(!/^(https?:\/\/|mailto:)/i.test(decoded)) return m;
    return `<a href="${esc(decoded)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text=text.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  text=text.replace(/__([^_]+)__/g,"<strong>$1</strong>");
  text=text.replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<em>$2</em>");
  text=text.replace(/(^|[^_])_([^_\n]+)_/g,"$1<em>$2</em>");

  codeSpans.forEach((html,i)=>{
    text=text.replace(`@@CODE${i}@@`,html);
  });
  return text;
}

function renderMarkdown(source){
  const input=String(source??"").replace(/\r\n?/g,"\n");
  if(!input.trim()) return '<span class="muted">暂无备注</span>';

  const parts=input.split(/```/);
  let html="";

  for(let partIndex=0;partIndex<parts.length;partIndex++){
    const part=parts[partIndex];
    if(partIndex%2===1){
      let code=part;
      const firstNl=code.indexOf("\n");
      if(firstNl>=0){
        const maybeLang=code.slice(0,firstNl).trim();
        if(/^[a-zA-Z0-9_+.#-]{1,20}$/.test(maybeLang)) code=code.slice(firstNl+1);
      }
      html+=`<pre><code>${esc(code.replace(/^\n|\n$/g,""))}</code></pre>`;
      continue;
    }

    const lines=part.split("\n");
    let paragraph=[];
    let listType=null;
    let listItems=[];

    const flushParagraph=()=>{
      if(!paragraph.length) return;
      html+=`<p>${paragraph.map(markdownInline).join("<br>")}</p>`;
      paragraph=[];
    };
    const flushList=()=>{
      if(!listItems.length) return;
      const tag=listType||"ul";
      html+=`<${tag}>${listItems.map(x=>`<li>${markdownInline(x)}</li>`).join("")}</${tag}>`;
      listItems=[];
      listType=null;
    };

    for(const line of lines){
      const trimmed=line.trim();
      if(!trimmed){
        flushParagraph();
        flushList();
        continue;
      }

      const heading=trimmed.match(/^(#{1,6})\s+(.+)$/);
      if(heading){
        flushParagraph(); flushList();
        const level=heading[1].length;
        html+=`<h${level}>${markdownInline(heading[2])}</h${level}>`;
        continue;
      }

      const ul=trimmed.match(/^[-*+]\s+(.+)$/);
      if(ul){
        flushParagraph();
        if(listType && listType!=="ul") flushList();
        listType="ul";
        listItems.push(ul[1]);
        continue;
      }

      const ol=trimmed.match(/^\d+[.)]\s+(.+)$/);
      if(ol){
        flushParagraph();
        if(listType && listType!=="ol") flushList();
        listType="ol";
        listItems.push(ol[1]);
        continue;
      }

      if(listItems.length) flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
  }

  return html;
}

function notePreview(note,maxLen=72){
  const plain=String(note??"").replace(/```[\s\S]*?```/g," [代码] ")
    .replace(/[*_`#>-]/g," ")
    .replace(/\s+/g," ").trim();
  if(!plain) return "暂无备注";
  return plain.length>maxLen ? plain.slice(0,maxLen)+"…" : plain;
}

function td(v,c=""){return `<td class="${c}">${v??""}</td>`}

function taskId(n){return `Task-${n}`}

function issueId(n){return `Issue-${n}`}

function badge(s,type="task"){let c=type==="issue"?(s==="Open"?"red":(["Closed","Resolved"].includes(s)?"green":s==="In Progress"?"yellow":s==="Blocked"?"orange":"blue")):(s==="已完成"?"green":s==="进行中"?"yellow":s==="阻塞"?"orange":"blue");return `<span class="badge ${c}">${esc(s)}</span>`}

function vers(v){return (v||[]).map(x=>`<span class="version-chip">${esc(x)}</span>`).join("")}
