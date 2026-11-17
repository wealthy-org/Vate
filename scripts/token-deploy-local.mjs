// Local, unsigned preparation only. NEVER reads keys or sends a transaction.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeDeployData, keccak256 } from 'viem';
const treasury = '0xC767E869f214A6301B378F48E4e7035166D9416b';
const artifact = JSON.parse(readFileSync(resolve('contracts/out/VATEToken.sol/VATEToken.json'), 'utf8'));
const bytecode = artifact.bytecode?.object;
if (!/^0x[0-9a-f]+$/i.test(bytecode ?? '') || bytecode.length < 10) throw new Error('Missing compiled VATEToken bytecode. Run forge build in contracts first.');
const data = encodeDeployData({ abi: artifact.abi, bytecode, args: [treasury] });
const config = { treasury, data, hash: keccak256(data) };
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VATE — unsigned deployment check</title>
<style>body{background:#eef5f3;color:#183038;font:16px system-ui;max-width:850px;margin:48px auto;padding:24px}section{background:white;border:1px solid #cbded7;border-radius:18px;padding:26px}button{padding:14px 20px;border:0;border-radius:30px;background:#087d75;color:white;font:inherit;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}small{display:block;margin-top:20px}h1{font-size:25px}</style>
<section><h1>VATE — deployment preparation</h1><p>READ-ONLY CHECK. This page cannot submit a transaction.</p><p>100,000,000 VATE · 18 decimals · fixed supply</p><p>Treasury: ${treasury}</p><button id="check">Connect MetaMask + estimate gas</button><pre id="out">No wallet connected.</pre><small>No seed phrase, private key, signature or token approval required. Never paste secrets here.</small></section>
<script>
const config=${JSON.stringify(config)};
const out=document.getElementById('out');
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
  out.textContent=['PASS — account and chain matched','Account: '+accounts[0],'Chain: '+BigInt(chain),'Estimated gas: '+gas,'Illustrative buffered gas: '+limit,'Current gas price (wei): '+price,'Illustrative buffered cost (ETH): '+format(limit*price),'Balance (ETH): '+format(balance),'Initcode hash: '+config.hash,'','Gas price can change; this is not a guaranteed quote.','No transaction sent. No contract deployed.','Copy this output to review before proceeding.'].join('\\n');
 } catch(e){out.textContent='STOP: '+(e.message??e)}finally{this.disabled=false}
};
</script></html>`;
const server=http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:8787'){res.writeHead(403);res.end('Local access only');return;}
 if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(html);
});
server.on('error',e=>{console.error(e.message);process.exitCode=1});
server.listen(8787,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8787 in your MetaMask browser. Read-only preparation; no deployment button. Stop with Ctrl+C.'));
