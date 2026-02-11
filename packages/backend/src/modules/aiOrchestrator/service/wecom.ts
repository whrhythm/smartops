import fetch from 'node-fetch';

import { WecomConfig } from './config';

type WecomTokenResponse = {
  access_token: string;
  expires_in: number;
  errcode: number;
  errmsg: string;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

const getWecomToken = async (config: WecomConfig) => {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpId}&corpsecret=${config.secret}`;
  const response = await fetch(url);
  const data = (await response.json()) as WecomTokenResponse;

  if (data.errcode !== 0) {
    throw new Error(`WeCom token error: ${data.errmsg}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return cachedToken.token;
};

export const sendWecomText = async (
  config: WecomConfig,
  userId: string,
  text: string,
) => {
  const token = await getWecomToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: config.agentId,
    text: { content: text },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const textBody = await response.text();
    throw new Error(`WeCom send error ${response.status}: ${textBody}`);
  }

  return response.json();
};
