import { releasedEntries } from './data';
import { renderInline } from './inline';
import './page.css';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}

const host = document.getElementById('changelog-entries');
if (host) {
  if (!releasedEntries.length) {
    host.append(node('p', 'No updates have shipped yet. Check back soon.', 'gt-changelog-empty'));
  }
  for (const entry of releasedEntries) {
    const section = node('section', '', 'gt-changelog-entry');
    const head = node('div', '', 'gt-changelog-entry-head');
    head.append(node('h2', entry.title || entry.version));
    if (entry.date) head.append(node('time', entry.date, 'gt-changelog-when'));
    section.append(head);
    const list = node('ul');
    for (const bullet of entry.bullets) { const li = node('li'); renderInline(li, bullet); list.append(li); }
    section.append(list);
    host.append(section);
  }
}
