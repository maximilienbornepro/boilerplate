// Boilerplate - Delivery Export — Figma Plugin
// This code runs in Figma's sandbox.
// Uses the boilerplate API with per-board model (dynamic totalCols).

figma.showUI(__html__, { width: 400, height: 580 });

figma.ui.onmessage = async (msg) => {
  console.log('Message received:', msg.type);

  if (msg.type === 'import-tasks') {
    const { boardName, totalCols, tasks, config } = msg;

    console.log('Importing', tasks ? tasks.length : 0, 'tasks for board:', boardName, '(', totalCols, 'cols)');

    if (!tasks || tasks.length === 0) {
      figma.notify('Aucune tache a importer', { error: true });
      return;
    }

    const COLUMN_WIDTH = (config && config.columnWidth) || 560;
    const ROW_HEIGHT = (config && config.rowHeight) || 200;

    const viewportCenter = figma.viewport.center;
    const START_X = viewportCenter.x;
    const START_Y = viewportCenter.y;

    const fallbackCols = totalCols || 6;
    const nodes = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      try {
        const node = figma.createNodeFromSvg(task.svg);

        let x, y;
        if (task.position) {
          x = START_X + task.position.startCol * COLUMN_WIDTH;
          y = START_Y + task.position.row * ROW_HEIGHT;
        } else {
          const col = i % fallbackCols;
          const row = Math.floor(i / fallbackCols);
          x = START_X + col * COLUMN_WIDTH;
          y = START_Y + row * ROW_HEIGHT;
        }

        node.x = x;
        node.y = y;
        node.name = task.jiraKey || ('Task ' + (i + 1));

        nodes.push(node);
      } catch (error) {
        console.error('Error creating node for task:', task.jiraKey, error);
      }
    }

    if (nodes.length > 0) {
      const group = figma.group(nodes, figma.currentPage);
      group.name = 'Delivery - ' + (boardName || 'Board') + ' (' + nodes.length + ' taches)';

      figma.currentPage.selection = [group];
      figma.viewport.scrollAndZoomIntoView([group]);
    }

    figma.notify(nodes.length + ' taches importees (' + (boardName || 'Board') + ')');
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
