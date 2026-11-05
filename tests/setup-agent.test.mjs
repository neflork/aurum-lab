import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAgentScan} from '../lib/setup-agent.ts';
const plan={name:'Пробой',side:'long',reason:'Уровень 100 по структуре',confirmation:'Закрытие выше 100',invalidation:'Возврат под 95',entry:100,stop:95,target:110,targetKind:'structure'};
const scan=p=>JSON.stringify({readout:'Ожидание пробоя',plans:[p]});
test('agent levels calculate reward and always require confirmation',()=>{const p=parseAgentScan(scan({...plan,rr:100,status:'confirmed'})).plans[0];assert.equal(p.rr,2);assert.equal(p.status,'waiting');});
test('invalid geometry and fabricated reward ratios cannot enter cards',()=>{for(const p of [{...plan,stop:105},{...plan,target:101,rr:2},{...plan,entry:'100'},{...plan,side:'neutral'},{...plan,target:0}])assert.throws(()=>parseAgentScan(scan(p)));});
test('short levels and honest no-setup answer are accepted',()=>{assert.equal(parseAgentScan(scan({...plan,side:'short',stop:105,target:90})).plans[0].rr,2);assert.deepEqual(parseAgentScan('{"readout":"Нет условий","plans":[]}').plans,[]);});
test('malformed plans and incomplete answers fail visibly',()=>{assert.throws(()=>parseAgentScan('не JSON'));assert.throws(()=>parseAgentScan(scan({...plan,confirmation:''})));assert.throws(()=>parseAgentScan('{"plans":[]}'));});
