export const componentStyles = `
  .cl-matching-eye {
    width: 100%;
    overflow: hidden;
    color: #e9e8dd;
    background: transparent;
    font-family: inherit;
  }
  .cl-matching-eye__stage {
    position: relative;
    width: 100%;
    height: var(--report-scene-height, 200px);
    overflow: hidden;
  }
  .cl-matching-eye__stage canvas,
  .cl-matching-eye__stage svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cl-matching-eye__center {
    position: absolute;
    top: calc(50% + 14px);
    left: 50%;
    transform: translateX(-50%);
    color: #ede6bd;
    font-size: 9px;
    line-height: 1.4;
    letter-spacing: .03em;
    pointer-events: none;
  }
  .cl-matching-eye__selection {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    margin: 0;
    height: 42px;
    padding: 0 12px 8px;
    overflow: hidden;
    color: #c3c8b8;
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .cl-matching-eye details {
    border-top: 1px solid #34382c;
  }
  .cl-matching-eye summary {
    min-height: 40px;
    padding: 10px 12px;
    color: #deded4;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
  }
  .cl-matching-eye__list {
    display: grid;
    gap: 4px;
    max-height: 170px;
    margin: 0;
    padding: 0 10px 10px;
    overflow: auto;
    list-style: none;
    scrollbar-color: #758062 #151a10;
  }
  .cl-matching-eye__list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 9px 10px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: #c6c8be;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .cl-matching-eye__list button:hover,
  .cl-matching-eye__list button[aria-pressed="true"] {
    background: #1c1e18;
    color: #fff;
  }
  .cl-matching-eye button:focus-visible,
  .cl-matching-eye summary:focus-visible {
    outline: 2px solid #ebd97a;
    outline-offset: -2px;
  }
  .cl-matching-eye__list button > span:first-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .cl-matching-eye__list button > span:last-child {
    flex-shrink: 0;
    color: #ececdf;
  }
  .cl-matching-eye__search {
    display: grid;
    gap: 6px;
    margin: 0 12px 10px;
    color: #c8cebd;
    font-size: 11px;
  }
  .cl-matching-eye__search input {
    width: 100%;
    min-height: 36px;
    padding: 8px;
    border: 1px solid #596348;
    border-radius: 6px;
    background: #11170e;
    color: #f1f2e9;
    caret-color: #ebd97a;
    font: inherit;
  }
  .cl-matching-eye__search input::placeholder {
    color: #b5bda7;
  }
  .cl-matching-eye__pages {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 12px;
    color: #c8cebd;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .cl-matching-eye__pages button {
    min-height: 32px;
    padding: 6px 8px;
    border: 1px solid #596348;
    border-radius: 6px;
    background: #182012;
    color: #edf0e4;
    font: inherit;
    cursor: pointer;
  }
  .cl-matching-eye__pages button:disabled {
    opacity: .42;
    cursor: default;
  }
  @media print {
    .cl-matching-eye__selection,
    .cl-matching-eye details { display: none; }
  }
`;
