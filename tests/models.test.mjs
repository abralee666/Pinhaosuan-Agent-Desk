import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexCatalog,antigravityCatalog,resolveSelection,codexTurnOptions,antigravityModelArgs} from '../lib/models.mjs';

test('Codex capabilities restrict efforts and translate selected options to turn parameters',()=>{
  const models=codexCatalog([{model:'test-model',displayName:'Test',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low'},{model:'hidden',hidden:true}]);
  assert.equal(models.length,1);
  const selection=resolveSelection(models,{model:'test-model',effort:'high'});
  assert.deepEqual(codexTurnOptions(selection),{model:'test-model',effort:'high'});
  assert.throws(()=>resolveSelection(models,{model:'test-model',effort:'max'}),/不支持/);
  assert.throws(()=>resolveSelection(models,{model:'invented'}),/目录/);
});
test('Gemini efforts select discovered variants; models without effort metadata reject overrides',()=>{
  const models=antigravityCatalog('Fetching available models...\ngemini-example-high\tGemini Example (High)\ngemini-example-low\tGemini Example (Low)\nclaude-example\tClaude Example (Thinking)\ngpt-example-medium\tGPT Example (Medium)');
  assert.equal(models.length,3);
  assert.deepEqual(antigravityModelArgs(resolveSelection(models,{model:'gemini-example',effort:'low'})),['--model','gemini-example-low']);
  assert.throws(()=>resolveSelection(models,{model:'gemini-example',effort:'medium'}),/不支持/);
  assert.deepEqual(antigravityModelArgs(resolveSelection(models,{model:'claude-example'})),['--model','claude-example']);
  assert.throws(()=>resolveSelection(models,{model:'claude-example',effort:'high'}),/不支持/);
  assert.throws(()=>resolveSelection(models,{model:'gpt-example-medium',effort:'high'}),/不支持/);
});
test('legacy requests keep official session defaults without inventing a model',()=>{
  assert.deepEqual(codexTurnOptions(resolveSelection([])),{});
  assert.deepEqual(antigravityModelArgs(resolveSelection([])),[]);
  assert.throws(()=>resolveSelection([],{effort:'high'}),/先选择/);
});
test('Fast is gated by official catalog capabilities and can be explicitly turned off',()=>{
  const catalog=codexCatalog([{model:'capable',supportedReasoningEfforts:[],serviceTiers:[{id:'fast',name:'Fast'}]},{model:'standard',supportedReasoningEfforts:[]}]);
  assert.equal(codexTurnOptions(resolveSelection(catalog,{model:'capable',serviceTier:'fast'})).serviceTier,'fast');
  assert.equal(codexTurnOptions(resolveSelection(catalog,{model:'capable',serviceTier:'default'})).serviceTier,null);
  assert.throws(()=>resolveSelection(catalog,{model:'standard',serviceTier:'fast'}),/未提供 Fast/);
  assert.throws(()=>resolveSelection(catalog,{model:'capable',serviceTier:'invented'}),/速度模式/);
  assert.throws(()=>resolveSelection(antigravityCatalog('gemini-x-low\tGemini X (Low)'),{model:'gemini-x',serviceTier:'fast'}),/未提供 Fast/);
  const older=codexCatalog([{model:'priority-model',supportedReasoningEfforts:[],serviceTiers:[{id:'priority',name:'Fast'}]}]);
  assert.equal(codexTurnOptions(resolveSelection(older,{model:'priority-model',serviceTier:'fast'})).serviceTier,'priority');
});
test('fallback smoothly switches to optimal available model when high model is absent on free tier',()=>{
  const freeCatalog=codexCatalog([
    {model:'gpt-4o-mini',displayName:'GPT-4o mini',supportedReasoningEfforts:[],defaultReasoningEffort:''},
    {model:'gpt-4o',displayName:'GPT-4o',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',isDefault:true}
  ]);
  const result=resolveSelection(freeCatalog,{model:'o1-pro',effort:'high',serviceTier:'fast'},{fallback:true});
  assert.equal(result.fellBack,true);
  assert.equal(result.model,'gpt-4o');
  assert.equal(result.originalModel,'o1-pro');
  assert.equal(result.effort,'medium');
  assert.equal(result.serviceTier,'default');
});
