/** A pinned chat block's tab is an ordinary host screen backed by the shared block widget. */
export function blockTabScreen(definition) {
    if (definition?.pack !== 'chat' || !definition.show?.tab) return null;
    return { id: `story-block/block/${definition.slug}`, title: definition.show.tabName, icon: definition.show.icon,
        mounts: ['screen', 'tab'], order: 206,
        template: `<ss-widget name="story-block.block" data-props='{"module":"${definition.id}"}'></ss-widget>`, pack: 'chat' };
}
