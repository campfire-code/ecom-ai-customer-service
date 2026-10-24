// 工具声明：多平台 AI 客服（半自动：粘贴顾客的话 → 查本地知识库 → 大模型起草回复 → 人工复制发送）
import { Headset as HeadsetIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Assistant } from './Main';

const tool: CustomTool = {
  id: 'e25',
  name: '多平台 AI 客服',
  tagline: '把顾客的问题粘贴进来，先查你自己维护的店铺知识库，再让大模型起草 1～3 条回复，一键复制后手动发送。不碰任何平台客户端，资料里没有的绝不乱答。',
  icon: HeadsetIcon,
  category: '电商运营',
  type: 'text',
  mode: 'custom',
  needsLLM: true,
  mainLabel: '客服助手',
  params: [],
  Main: ({ ctx }) => createElement(Assistant, { ctx }),
};

export default tool;
