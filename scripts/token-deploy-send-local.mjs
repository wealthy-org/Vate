// Local mainnet deployment UI. Signing is requested ONLY on explicit Deploy click. Never reads keys.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeDeployData, keccak256 } from 'viem';
const treasury = '0xC767E869f214A6301B378F48E4e7035166D9416b';
const artifact = JSON.parse(readFileSync(resolve('contracts/out/VATEToken.sol/VATEToken.json'), 'utf8'));
const bytecode = artifact.bytecode?.object;
if (!/^0x[0-9a-f]+$/i.test(bytecode ?? '') || bytecode.length < 10) throw new Error('Missing compiled VATEToken bytecode. Run forge build in contracts first.');
const data = encodeDeployData({ abi: artifact.abi, bytecode, args: [treasury] });
const config = { treasury, data, hash: keccak256(data), supplySelector: keccak256('0x746f74616c537570706c792829').slice(0,10), balanceSelector: keccak256('0x62616c616e63654f66286164647265737329').slice(0,10) };
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VATE — mainnet token deployment</title>
<style>body{background:#eef5f3;color:#183038;font:16px system-ui;max-width:850px;margin:48px auto;padding:24px}section{background:white;border:1px solid #cbded7;border-radius:18px;padding:26px}button{padding:14px 20px;border:0;border-radius:30px;background:#087d75;color:white;font:inherit;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}small{display:block;margin-top:20px}h1{font-size:25px}</style>
<section><h1>VATE — MAINNET deployment</h1><p>Deployment spends real ETH. Immutable token: no further mint, admin, tax, pause or upgrade. No promised price, yield or vault rights.</p><p>100,000,000 VATE · 18 decimals · fixed supply</p><p>Treasury: ${treasury}</p><button id="check">Connect MetaMask + estimate gas</button><p><label><input id="ack" type="checkbox"> I approve deploying this fixed supply to the treasury above.</label></p><p>Type DEPLOY VATE: <input id="phrase" autocomplete="off"></p><button id="deploy" disabled>Deploy — open MetaMask confirmation</button> <button id="receipt">Check saved transaction</button><pre id="out">No wallet connected.</pre><small>Never enter a seed phrase or private key. Deployment requests a transaction confirmation, not token approval. Never paste secrets here.</small></section>
<script>
const config=${JSON.stringify(config)};
const out=document.getElementById('out');
const send=document.getElementById('deploy');
const storageKey='vate-token-deployment-4663-'+config.treasury.toLowerCase();
let ready=false;
function provider(){const p=window.ethereum;return p?.providers?.find(x=>x.isMetaMask)??p;}
async function identity(){
 const p=provider();if(!p)throw Error('MetaMask missing');
 const a=await p.request({method:'eth_accounts'});
 if(a[0]?.toLowerCase()!==config.treasury.toLowerCase())throw Error('Treasury account mismatch');
 if(BigInt(await p.request({method:'eth_chainId'}))!==4663n)throw Error('Wrong chain');return p;
}
function update(){send.disabled=!ready||!document.getElementById('ack').checked||document.getElementById('phrase').value!=='DEPLOY VATE'||!!localStorage.getItem(storageKey);}
document.getElementById('ack').onchange=update;document.getElementById('phrase').oninput=update;
window.ethereum?.on?.('accountsChanged',()=>{ready=false;update()});
window.ethereum?.on?.('chainChanged',()=>{ready=false;update()});
if(localStorage.getItem(storageKey))out.textContent='A deployment attempt is saved. Click Check saved transaction. Do not deploy again.';
send.onclick=async()=>{
 send.disabled=true;let attempted=false;
 try{
  if(!ready||!document.getElementById('ack').checked||document.getElementById('phrase').value!=='DEPLOY VATE')throw Error('Complete all confirmations');
  if(localStorage.getItem(storageKey))throw Error('Previous attempt exists. Check it first.');
  const p=await identity();
  const tx={from:config.treasury,data:config.data,value:'0x0',chainId:'0x1237'};
  const gas=BigInt(await p.request({method:'eth_estimateGas',params:[tx]}));
  const limit=(gas*130n+99n)/100n+40000n;
  const price=BigInt(await p.request({method:'eth_gasPrice'}));
  const balance=BigInt(await p.request({method:'eth_getBalance',params:[config.treasury,'latest']}));
  if(balance<limit*price)throw Error('Insufficient ETH for buffered estimate');
  if(!confirm('Deploy 100,000,000 VATE on MAINNET to '+config.treasury+'? Real gas cost. Review the final fee in MetaMask.')){update();return;}
  await identity();
  localStorage.setItem(storageKey,JSON.stringify({state:'submitted-or-awaiting-wallet',initcodeHash:config.hash}));attempted=true;
  out.textContent='Review contract deployment in MetaMask. If result is unclear, do not retry.';
  tx.gas='0x'+limit.toString(16);
  const hash=await p.request({method:'eth_sendTransaction',params:[tx]});
  localStorage.setItem(storageKey,JSON.stringify({hash,initcodeHash:config.hash}));
  out.textContent='Transaction sent: '+hash+' — Save this hash now. Click Check saved transaction after confirmation. Explorer: https://robinhoodchain.blockscout.com/tx/'+hash;
 }catch(e){
  if(attempted&&e.code===4001)localStorage.removeItem(storageKey);
  out.textContent='STOP: '+(e.message??e)+(attempted&&e.code!==4001?' — Result may be ambiguous. Check wallet Activity before any retry.':'');
 }finally{update()}
};
document.getElementById('receipt').onclick=async()=>{
 try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(!saved?.hash)throw Error(saved?'Attempt saved without hash. Check MetaMask Activity. Do not retry deployment.':'No saved transaction');
  const p=await identity();
  const r=await p.request({method:'eth_getTransactionReceipt',params:[saved.hash]});
  if(!r){out.textContent='Pending or not yet visible: '+saved.hash;return;}
  if(BigInt(r.status)!==1n)throw Error('Transaction failed: '+saved.hash+'. Review before any further action.');
  if(!r.contractAddress)throw Error('No contract address in receipt');
  const original=await p.request({method:'eth_getTransactionByHash',params:[saved.hash]});
  if(original.to||original.from.toLowerCase()!==config.treasury.toLowerCase()||original.input.toLowerCase()!==config.data.toLowerCase())throw Error('Transaction does not match this deployment');
  const code=await p.request({method:'eth_getCode',params:[r.contractAddress,'latest']});
  if(code==='0x')throw Error('No contract code');
  const supply=BigInt(await p.request({method:'eth_call',params:[{to:r.contractAddress,data:config.supplySelector},'latest']}));
  const balance=BigInt(await p.request({method:'eth_call',params:[{to:r.contractAddress,data:config.balanceSelector+config.treasury.slice(2).toLowerCase().padStart(64,'0')},'latest']}));
  if(supply!==100000000n*10n**18n||balance!==supply)throw Error('Supply or initial treasury balance does not match expected values');
  out.textContent='SUCCESS — receipt and initial supply checked. Transaction: '+saved.hash+' — Contract: '+r.contractAddress+' — Supply: 100,000,000 VATE. Save both. Source verification is still required. Explorer: https://robinhoodchain.blockscout.com/address/'+r.contractAddress;
 }catch(e){out.textContent='STOP: '+(e.message??e)}
};
document.getElementById('check').onclick=async function(){
 this.disabled=true;
 try {
  const injected=window.ethereum;
  const provider=injected?.providers?.find(p=>p.isMetaMask)??injected;
  if(!provider)throw Error('MetaMask not detected. Use the browser profile containing your treasury wallet.');
  const accounts=await provider.request({method:'eth_requestAccounts'});
  if(accounts[0]?.toLowerCase()!==config.treasury.toLowerCase())throw Error('Wrong account. Select the treasury account in MetaMask and retry.');
  const chain=await provider.request({method:'eth_chainId'});
  if(BigInt(chain)!==4663n)throw Error('Wrong chain. Select Robinhood Chain mainnet (4663) in MetaMask and retry.');
  out.textContent='Account and chain matched. Estimating the actual constructor bytecode…';
  const tx={from:accounts[0],data:config.data,value:'0x0'};
  const gas=BigInt(await provider.request({method:'eth_estimateGas',params:[tx]}));
  const price=BigInt(await provider.request({method:'eth_gasPrice'}));
  const balance=BigInt(await provider.request({method:'eth_getBalance',params:[accounts[0],'latest']}));
  const limit=(gas*130n+99n)/100n+40000n;
  const format=n=>{const s=n.toString().padStart(19,'0');return s.slice(0,-18)+'.'+s.slice(-18)};
  ready=true; update();
  out.textContent=['PASS — account and chain matched','Account: '+accounts[0],'Chain: '+BigInt(chain),'Estimated gas: '+gas,'Illustrative buffered gas: '+limit,'Current gas price (wei): '+price,'Illustrative buffered cost (ETH): '+format(limit*price),'Balance (ETH): '+format(balance),'Initcode hash: '+config.hash,'','Gas price can change; this is not a guaranteed quote.','Check passed. Deployment requires the separate Deploy button and MetaMask confirmation.','Compare initcode hash with your previous check before deploying.'].join('\\n');
 } catch(e){out.textContent='STOP: '+(e.message??e)}finally{this.disabled=false}
};
</script></html>`;
const server=http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:8787'){res.writeHead(403);res.end('Local access only');return;}
 if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(html);
});
server.on('error',e=>{console.error(e.message);process.exitCode=1});
server.listen(8787,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8787 in your MetaMask browser. MAINNET deployment UI. Explicit click + MetaMask confirmation required. Stop with Ctrl+C.'));
