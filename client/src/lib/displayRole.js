/** Device role is independent of window width: a small Windows window is still
 * a TV/host, while a rotated phone remains a controller. */
export function displayRole({userAgent = '', userAgentData, platform = '', maxTouchPoints = 0} = {}) {
  if (/Windows Phone/i.test(userAgent)) return 'remote';
  if (/Windows|CrOS|SmartTV|Smart-TV|HbbTV|Tizen|webOS|Web0S|AFT\w*|Android.?TV|BRAVIA|CrKey/i.test(userAgent)) return 'tv';
  if (userAgentData?.mobile || /iPhone|iPod|iPad|Android/i.test(userAgent)) return 'remote';
  if (/Mac/i.test(platform || userAgent) && maxTouchPoints > 1) return 'remote';
  return 'tv';
}
