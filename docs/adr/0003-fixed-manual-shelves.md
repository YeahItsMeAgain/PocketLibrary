# Shelves are fixed physical boards with manual placement

A shelf is furniture: a named board holding a fixed number of books in the order the user sets. The library is a wall of many such shelves, scrolled as a finite space. New books go to the lowest shelf with free space, and from then on only the user moves a book.

There is no automatic sorting and no endless scrolling row. Sorting was considered but rejected for now: the user wants to place books deliberately, and automatic reflow would move books they had positioned. This constrains the shelf view to finite, bounded scenes, which also helps WebView performance.
