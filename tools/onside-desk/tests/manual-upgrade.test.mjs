import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,sha256,applyOverrides} from '../core.mjs';
import {upgradeManualMvCases} from '../manual-upgrade.mjs';

test('MV parser upgrade repairs old blank metadata once and preserves intentional edits and history',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'onside-manual-upgrade-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=await new Store(root).init(),outputRoot=path.join(root,'신청별 자료'),id='manual-fixture';
 const dir=path.join(outputRoot,id,'기준파일');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'reference.hwp');await fs.writeFile(file,'original reference');
 const original={id,type:'MV_DISTRIBUTION',title:'Old album fallback',artist_name:'',mv_director:'',mv_storyline:'',mv_lyrics:'preserved lyric',created_at:'2026-10-25T00:00:00Z'};
 store.data.cases[id]={source:'manual',submission:original,detail:{submission:original,tracks:[{id:'old-track'}]},local:{notes:'Keep notes',overrides:{submission:{title:original.title,artist_name:'',mv_director:'Administrator corrected director',mv_storyline:''},tracks:[{id:'old-track'}]}},generations:[{id:'old-output'}],attachments:[{name:'received.mp4'}],importInfo:{filename:'reference.hwp',sha256:await sha256(file)}};
 let calls=0;const importer=async()=>{calls++;return {submission:{title:'Correct song',artist_name:'Derringer',mv_director:'Reference director',mv_storyline:'Full synopsis',mv_lyrics:'preserved lyric'},tracks:[],extractedText:'source text',format:'hwp',warnings:[]};};
 await upgradeManualMvCases({store,outputRoot,importer});const item=store.data.cases[id],effective=applyOverrides(item.detail,item.local);
 assert.equal(effective.submission.artist_name,'Derringer');assert.equal(effective.submission.title,'Correct song');assert.equal(effective.submission.mv_director,'Administrator corrected director');assert.equal(effective.submission.mv_storyline,'Full synopsis');assert.deepEqual(effective.tracks,[]);
 assert.equal(item.local.notes,'Keep notes');assert.equal(item.generations.length,1);assert.equal(item.attachments.length,1);assert.equal(item.sourceChanged,true);assert.equal(item.importInfo.parserVersion,3);
 assert.equal(await fs.readFile(file,'utf8'),'original reference');assert.equal((await fs.readdir(path.join(root,'자동백업'))).length,1);
 await upgradeManualMvCases({store,outputRoot,importer});assert.equal(calls,1);
});

test('MV upgrade leaves stored data intact if reference changed or cannot be read',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'onside-manual-upgrade-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=await new Store(root).init(),outputRoot=path.join(root,'신청별 자료'),id='manual-unreadable';
 const submission={id,type:'MV_BROADCAST',artist_name:'Keep artist'};store.data.cases[id]={source:'manual',submission,detail:{submission,tracks:[]},local:{notes:'Keep notes'},importInfo:{filename:'missing.hwp'}};
 await upgradeManualMvCases({store,outputRoot,importer:async()=>{throw Error('should not reach');}});
 assert.equal(store.data.cases[id].submission.artist_name,'Keep artist');assert.ok(store.data.cases[id].importInfo.warnings.length);assert.notEqual(store.data.cases[id].importInfo.parserVersion,3);
});
