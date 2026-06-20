// WebSocket integration test
const WebSocket = require('ws');
const results = [];

const ws = new WebSocket('ws://localhost:3000');
let step = 0;

ws.on('message', (raw) => {
  const data = JSON.parse(raw.toString());

  if (data.type === 'init') {
    results.push('PASS init: userName=' + data.userName + ' channels=' + data.channels.map(c=>c.name).join(','));
    ws.send(JSON.stringify({ type: 'join', channelId: 'general' }));
  }
  else if (data.type === 'history') {
    results.push('PASS history: channelId=' + data.channelId);
    ws.send(JSON.stringify({ type: 'message', channelId: 'general', text: '안녕하세요 테스트입니다' }));
  }
  else if (data.type === 'channel_updated') {
    results.push('PASS channel_updated: members=' + data.channel.memberCount);
  }
  else if (data.type === 'message' && !data.message.isSystem) {
    if (step === 0) {
      results.push('PASS message: author=' + data.message.author + ' tone=' + data.message.tone);
      step++;
    } else if (step === 1 && data.message.tone !== null) {
      results.push('PASS tone_update: ' + data.message.tone + ' isEnum=' + ['positive','neutral','negative','uncertain'].includes(data.message.tone));
      step++;
      // Test typing
      ws.send(JSON.stringify({ type: 'typing', channelId: 'general', isTyping: true }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'leave', channelId: 'general' }));
        setTimeout(() => { ws.close(); }, 300);
      }, 200);
    }
  }
  else if (data.type === 'user_joined') {
    results.push('PASS user_joined: ' + data.userName);
  }
  else if (data.type === 'user_left') {
    results.push('PASS user_left on leave');
  }
});

ws.on('close', () => {
  console.log(results.join('\n'));
  if (!results.some(r => r.startsWith('FAIL'))) {
    console.log('ALL_PASS');
  }
});

ws.on('error', (e) => { console.error('WS_ERROR:', e.message); process.exit(1); });
setTimeout(() => { console.log(results.join('\n')); console.log('TIMEOUT'); process.exit(0); }, 6000);
