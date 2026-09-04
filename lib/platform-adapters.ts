/**
 * Shared platform contract. Every future adapter must supply store-owned
 * catalogue facts and can only request a message draft; it never receives a
 * supplier record and never sends a message by itself.
 */
export type PlatformId = 'douyin' | 'taobao' | 'jd' | 'pdd' | 'other';

export type PlatformAdapterProfile = {
  platform: PlatformId;
  name: string;
  availability: 'ready' | 'planned';
  productFlow: string;
  messageFlow: string;
  connectionRequirement: string;
};

export const platformAdapters: PlatformAdapterProfile[] = [
  {
    platform: 'douyin', name: '抖店', availability: 'ready',
    productFlow: '网页商品管理同步 → 详情待审核 → 客服知识库',
    messageFlow: '飞鸽读取当前咨询商品 → 生成草稿／安全条件下自动回复',
    connectionRequirement: '在本地连接器浏览器登录抖店和飞鸽。',
  },
  {
    platform: 'taobao', name: '淘宝／天猫', availability: 'planned',
    productFlow: '网页商品管理或商品表导入 → 详情待审核 → 客服知识库',
    messageFlow: '旺旺读取当前咨询商品 → 生成草稿 → 人工确认或安全自动回复',
    connectionRequirement: '接入时需在本地连接器浏览器登录商家后台和旺旺。',
  },
  {
    platform: 'jd', name: '京东', availability: 'planned',
    productFlow: '商家后台商品同步或商品表导入 → 详情待审核 → 客服知识库',
    messageFlow: '咚咚读取当前咨询商品 → 生成草稿 → 人工确认或安全自动回复',
    connectionRequirement: '接入时需在本地连接器浏览器登录京东商家后台和咚咚。',
  },
  {
    platform: 'pdd', name: '拼多多', availability: 'planned',
    productFlow: '商家后台商品同步或商品表导入 → 详情待审核 → 客服知识库',
    messageFlow: '客服工作台读取当前咨询商品 → 生成草稿 → 人工确认或安全自动回复',
    connectionRequirement: '接入时需在本地连接器浏览器登录拼多多商家后台和客服工作台。',
  },
  {
    platform: 'other', name: '其他平台', availability: 'planned',
    productFlow: '先导入标准商品表 → 详情待审核 → 客服知识库',
    messageFlow: '先输出客服草稿，待接入平台消息工作台后再填入。',
    connectionRequirement: '需要确认该平台可用的商家网页端或官方接口。',
  },
];
