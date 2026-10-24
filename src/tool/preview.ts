// 截图与预览用的示例数据（不会进入正式运行）。预览页里助手会用这里的聊天记录和假大模型自动跑一遍。
export const demoChat = `顾客：你好，在吗
客服：在的亲
顾客：保温杯 A 款多少钱？
顾客：买回去不喜欢能退吗？`;

type Msg = { role: string; content: string };

/** 假大模型：按提示词里资料的编号，引用「保温杯 A 款」和「退换货规则」 */
export const fakeLlm = async (messages: Msg[]) => {
  const text = messages[messages.length - 1].content;
  const no = (title: string) => Number(text.match(new RegExp(`\\[(\\d+)\\] ${title}（`))?.[1] ?? 1);
  const refs = [no('保温杯 A 款'), no('退换货规则')];
  return JSON.stringify({
    grounded: true,
    missing: '',
    replies: [
      { text: '亲，保温杯 A 款日常价是 59 元哦，活动期间以活动页价格为准～签收后 7 天内，商品没用过、不影响二次销售就可以申请退换，您放心下单～', refs },
      { text: '您好，保温杯 A 款日常价 59 元，我们保证全网最低价。若收到后不合适，签收后 7 天内在未使用的情况下可以申请退换。', refs },
      { text: '59 元（活动价以活动页为准）。签收 7 天内未使用可退换。', refs },
    ],
  });
};
