// 設定項目 (スクリプトプロパティで管理)
const SCRIPT_PROPERTY_KEY_CHANNEL_ACCESS_TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
const SCRIPT_PROPERTY_KEY_TARGET_CHAT_ID = 'TARGET_CHAT_ID'; // 監視したいグループIDまたはルームID
const SCRIPT_PROPERTY_KEY_MONITORED_USER_ID = 'MONITORED_USER_ID'; // 発言を監視するユーザーID

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間
const SCRIPT_PROPERTY_PREFIX = "REMINDER_TIMER_FOR_"; // タイマーデータ保存用のスクリプトプロパティキー接頭辞

// LINEにメッセージを送信する関数
function sendLineMessage(toId, messageText) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const channelAccessToken = scriptProperties.getProperty(SCRIPT_PROPERTY_KEY_CHANNEL_ACCESS_TOKEN);

  if (!channelAccessToken) {
    // チャネルアクセストークンが未設定の場合は処理中断
    return;
  }

  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: toId,
    messages: [{
      type: 'text',
      text: messageText,
    }],
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // HTTPエラー時も例外をスローしない
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
  }
}

// WebhookでLINEからのイベントを受け取る関数
function doPost(e) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const targetChatIdSetting = scriptProperties.getProperty(SCRIPT_PROPERTY_KEY_TARGET_CHAT_ID);
    const monitoredUserIdSetting = scriptProperties.getProperty(SCRIPT_PROPERTY_KEY_MONITORED_USER_ID);
    const channelAccessToken = scriptProperties.getProperty(SCRIPT_PROPERTY_KEY_CHANNEL_ACCESS_TOKEN);

    // 必要な設定がスクリプトプロパティにない場合は処理中断
    if (!targetChatIdSetting || !monitoredUserIdSetting || !channelAccessToken) {
      return;
    }

    const eventData = JSON.parse(e.postData.contents);

    eventData.events.forEach(event => {
      const senderId = event.source.userId;
      let chatId = null;
      const sourceType = event.source.type; // "user", "group", "room"

      if (sourceType === 'group') {
        chatId = event.source.groupId;
      } else if (sourceType === 'room') {
        chatId = event.source.roomId;
      }

      // リマインダーロジック (グループ/ルームチャットのテキストメッセージのみ対象)
      if (event.type === 'message' && event.message.type === 'text') {
        if (sourceType !== 'group' && sourceType !== 'room') {
          return; // グループ/ルームチャット以外は無視
        }
        
        // イベントが発生したチャットIDが、設定された監視対象チャットIDと一致するか確認
        if (chatId === targetChatIdSetting) {
          const timerPropertyKey = SCRIPT_PROPERTY_PREFIX + chatId;
          
          // 1. このチャットに既存のタイマーがあればクリア
          if (scriptProperties.getProperty(timerPropertyKey)) {
            scriptProperties.deleteProperty(timerPropertyKey);
          }

          // 2. 発言者が監視対象ユーザーであれば新しいタイマーをセット
          if (senderId === monitoredUserIdSetting) {
            scriptProperties.setProperty(timerPropertyKey, JSON.stringify({
              timestamp: event.timestamp,      // メッセージ受信時刻
              monitoredUserId: senderId      // 発言した監視対象ユーザーID
            }));
          }
        }
      }
    });
  } catch (err) {
    // doPost内でのエラー処理
  }
}

// 定期実行してリマインダーをチェック・送信する関数
function checkAndSendReminders() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const allProperties = scriptProperties.getProperties();
  const currentTime = new Date().getTime();

  for (const key in allProperties) {
    if (key.startsWith(SCRIPT_PROPERTY_PREFIX)) {
      const chatId = key.substring(SCRIPT_PROPERTY_PREFIX.length);
      try {
        const timerData = JSON.parse(allProperties[key]);
        const messageTimestamp = timerData.timestamp;

        if (currentTime - messageTimestamp > REMINDER_INTERVAL_MS) {
          sendLineMessage(chatId, 'リマインド'); // 固定メッセージを送信
          scriptProperties.deleteProperty(key);  // 送信後はタイマー情報を削除
        }
      } catch (e) {
        // プロパティ解析エラー時は、そのプロパティを削除
        scriptProperties.deleteProperty(key);
      }
    }
  }
}

// -------------------------------------------------------------------------
// トリガー設定用（手動実行）
// -------------------------------------------------------------------------
function setupTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkAndSendReminders') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  // 新しいトリガーを設定 (1分ごとに 'checkAndSendReminders' を実行)
  ScriptApp.newTrigger('checkAndSendReminders')
    .timeBased()
    .everyMinutes(1)
    .create();
}