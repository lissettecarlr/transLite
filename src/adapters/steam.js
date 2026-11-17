// Steam 社区 / 商店适配器。
// 工坊（创意工坊）的标题、简介、作者都是 <div>，而且整个卡片是 <a class="workshopItem">，
// 默认规则既不会选 div，又会因为「在链接里」把它们当成可点击元素跳过，所以那一块一直没翻译。
(function registerSteamAdapter(root) {
  'use strict';

  // 工坊列表 + 详情页
  const workshopSelectors = [
    '.workshopItemTitle',
    '#highlightContent',
    '.workshopItemShortDesc',
    '.workshopItemAuthorName',
    '.workshopItemDescription',
    '.workshopItemDescriptionTitle',
    '.workshopItemTag',
    '.workshopTags',
    '.workshopItemPreviewImageContainer + div',
    '.requiredAgeBox',
  ];

  // 商店页 / 社区页常见正文块
  const communitySelectors = [
    '.apphub_AppName',
    '.game_area_description',
    '.game_area_dlc_name',
    '.game_area_details_specs',
    '.detailsStatRight',
    '.commentthread_comment_text',
    '.commentthread_author_link ~ .commentthread_comment_text',
    '.workshop_showcase_item_name',
  ];

  function matches(url) {
    if (!url) return false;
    let value;
    try {
      value = url instanceof URL ? url : new URL(String(url));
    } catch (_) {
      return false;
    }
    return /(^|\.)(steamcommunity\.com|steampowered\.com)$/i.test(value.hostname);
  }

  const adapters = root.LT_SITE_ADAPTERS || {};
  adapters.steam = {
    id: 'steam',
    label: 'Steam 社区',
    matches,
    // 工坊卡片本身就是链接，不放开这条会被 isClickable 全部跳过。
    allowInteractiveUi: true,
    minTextLength: 2,
    selectors: [...workshopSelectors, ...communitySelectors],
  };
  root.LT_SITE_ADAPTERS = adapters;
}(typeof globalThis !== 'undefined' ? globalThis : window));
