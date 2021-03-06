/*
    Copyright (C) 2014-2015  H3XL, Inc

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * @fileoverview JavaScript for BlocksCAD.
 * @author  jennie@einsteinsworkshop.com (jayod)
 */
'use strict';

// create Blockscad namespace
var Blockscad = Blockscad || {};
Blockscad.Toolbox = Blockscad.Toolbox || {};
BlocklyStorage = BlocklyStorage || {};
var OpenJsCad = OpenJsCad || {};
var Blockly = Blockly || {};
var BSUtils = BSUtils || {};

Blockscad.version = "1.0.0";

// -- BEGIN OPENJSCAD STUFF --

var gCurrentFile = null;
var gProcessor = null;
var editor = null;

var gCurrentFiles = [];       // linear array, contains files (to read)
var gMemFs = [];              // associated array, contains file content in source gMemFs[i].{name,source}
var gMemFsCount = 0;          // async reading: count of already read files
var gMemFsTotal = 0;          // async reading: total files to read (Count==Total => all files read)
var gMemFsChanged = 0;        // how many files have changed
var gRootFs = [];             // root(s) of folders 

var _includePath = './';
// -- END OPENJSCAD STUFF --

Blockscad.drawAxes = 1;       // start with axes drawn


/**
 * Initialize Blockly.  Called on page load.
 */
Blockscad.init = function() {
  Blockscad.initLanguage();

  var rtl = BSUtils.isRtl();
  Blockscad.missingFields = [];  // variable to see if any blocks are missing fields

  var container = document.getElementById('main');
  var onresize = function(e) {
    var bBox = BSUtils.getBBox_(container);
    var el = document.getElementById('blocklyDiv');
    el.style.top = bBox.y + 'px';
    el.style.left = bBox.x + 'px';
    // Height and width need to be set, read back, then set again to
    // compensate for scrollbars.
    el.style.height = bBox.height - 88 + 'px';
    el.style.width = bBox.width + 'px';

    // resize the viewer  
    if (gProcessor) {
      var h = gProcessor.viewerdiv.offsetHeight;
      var w = gProcessor.viewerdiv.offsetWidth;
      gProcessor.viewer.rendered_resize(w,h);
    }
    // position the div using left and top (that's all I get!)
    if ($( '#main' ).height() - $( '.resizableDiv' ).height() < 70)
      $( '.resizableDiv' ).height($( '#main' ).height() - 70);
    if ($( '#main' ).width() - $( '.resizableDiv' ).width() < 20)
      $( '.resizableDiv' ).width($( '#main' ).width() - 20);

    // reposition the resizable div.
    $(".resizableDiv").position({
      of: $('#main'),
      my: 'right top',
      at: 'right top',
      offset: '-12 -55'
    });
  };
  window.addEventListener('resize', onresize, false);

  Blockscad.workspace = Blockly.inject(document.getElementById('blocklyDiv'),
      {
       media: 'blockly/media/',
       rtl: rtl,
       toolbox: Blockscad.Toolbox.other});

  BSUtils.loadBlocks('');

  if ('BlocklyStorage' in window) {
    // Hook a save function onto unload.
    BlocklyStorage.backupOnUnload();
  }


  // how about putting in the viewer?

  $(".resizableDiv").resizable({
      handles: "s,w,sw",
      resize: function(event, ui) {
          var h = $( window ).height();
          // resize the viewer
          if (gProcessor) {
            var h = gProcessor.viewerdiv.offsetHeight;
            var w = gProcessor.viewerdiv.offsetWidth;
            gProcessor.viewer.rendered_resize(w,h);
          }
          // position the div using left and top (that's all I get!)
          if ($( '#main' ).width() - ui.size.width < 20)
            ui.size.width = $( '#main' ).width() - 20;
          if ($( '#main' ).height() - ui.size.height < 70)
            ui.size.height = $( '#main' ).height() - 70;

          ui.position.left = $( window ).width() - (ui.size.width + 12);
          ui.position.top = 55;
      }
  });

  Blockly.fireUiEvent(window, 'resize');

  // init the user auth stuff
  Blockscad.Auth.init();

  BSUtils.bindClick('trashButton',
     function() {Blockscad.discard(); });

  // render button should render geometry, draw axes, etc.
  BSUtils.bindClick('renderButton', Blockscad.doRender);



  // undo/redo buttons should undo/redo changes
  BSUtils.bindClick('undoButton', Blockscad.onUndo);
  BSUtils.bindClick('redoButton', Blockscad.onRedo);

  $( '#axesButton' ).click(function() {
    // toggle whether or not we draw the axes, then redraw
    Blockscad.drawAxes = (Blockscad.drawAxes + 1) % 2;
    $( '#axesButton' ).toggleClass("btn-pushed")
    gProcessor.viewer.onDraw();
  });

  // can I bind a click to a tab?
  $( '#displayCode' ).click(  function() {
    var content = document.getElementById('openScadPre');
    var code = Blockly.OpenSCAD.workspaceToCode(Blockscad.workspace);
    content.textContent = code;
    if (typeof prettyPrintOne == 'function') {
      code = content.innerHTML;
      code = prettyPrintOne(code, 'js');
      content.innerHTML = code; 
    }
    Blockly.fireUiEvent(window, 'resize');
  });


  // I think the render button should start out disabled.
  $('#renderButton').prop('disabled', true); 

  // set up the delete-confirm button's function.
  $('#throw-it-away').click(Blockscad.clearProject);
$( "#target" ).click(function() {
  alert( "Handler for .click() called." );
});


//FileSaver.js stuff
  // Loading a blocks xml file
  // if replaceOld is true, any current blocks are ditched, a new project is started
  // and the filename loaded is used as the project filename.
  // if replaceOld is false, the blocks are inserted in the current project,
  // adding to the blocks that are there already and not changing the filename.
  
  function readSingleFile(evt, replaceOld) {

    //Retrieve the first (and only!) File from the FileList object
    var f = evt.target.files[0]; 
    //console.log("in readSingleFile.  f is ", f);

    if (f) {

      if (replaceOld) {
        // use the name of the loaded file to fill the "file loading" and "project name" boxes.
        var proj_name = f.name.substr(0,f.name.lastIndexOf('(')) || f.name;
        proj_name = proj_name.substr(0,f.name.lastIndexOf('.')) || proj_name;

        // trim any whitespace from the beginning or end of the project name
        proj_name = proj_name.replace(/^\s+|\s+$/g,'');
      }

      // put up a "file loading/processing" message
      // by turning off the "project_name" element 
      // and turning on the "file_loadMessage" element
      //document.getElementById("project_name").style.display = "none";
      //document.getElementById("file_loadMessage").style.display = "inline";
      //document.getElementById("file_loadMessage").innerHTML = "Loading Project: " + proj_name;

      // first, autosave anything new.  Is there anything on the undo stack?  If so, save the changes.
      if (Blockscad.Auth.isLoggedIn && Blockscad.undo.undoStack.length > 0) {
        // console.log("autosaving!");
        Blockscad.Auth.saveBlocksToAccount();
      }


      if (replaceOld) {
        // if we had a current project before, we just changed to something else!
        Blockscad.Auth.currentProject = '';
        // clear the workspace to fit the new file contents.
        Blockly.getMainWorkspace().clear();
      }

      var contents = {};
      var stuff = {};
      var r = new FileReader();
      // all the file processing has to go inside the onload function. -JY
      r.onload = function(e) { 

        contents = e.target.result;  
        var xml = Blockly.Xml.textToDom(contents);
        Blockly.Xml.domToWorkspace(Blockly.getMainWorkspace(), xml); 
        Blockly.fireUiEvent(window, 'resize');

      }
      r.readAsText(f);

      if (replaceOld)
        $('#project-name').val(proj_name);

      // I should hide the projView, and show the editView.
      $('#projView').hide();
      $('#editView').show();

      // switch us back to the blocks tab in case we were on the code tabe.
      $('#displayBlocks').click();

    } else { 
      alert("Failed to load file");
    }
  }
  $('#file-menu').on('change', '#loadLocal', function(e) { readSingleFile(e, true)});
  $('#file-menu').on('change', '#importLocal', function(e) { readSingleFile(e, false)});
//End FileSaver.js stuff


  //Create the openjscad processing object instance
  gProcessor = new OpenJsCad.Processor(document.getElementById("renderDiv"));

  //render view reset button - JY
  BSUtils.bindClick('viewReset', Blockscad.resetView); 
  // $( '#viewMenu' ).change(function() {
  //   gProcessor.viewer.viewReset();
  // });

  // a bunch of stuff to support Undo/Redo
  Blockscad.undo = {
    blockList:[], // array to hold all old blocks
    oldBlockList:[], // array to hold old blocks
    undoStack:[], // array to hold undo xml trees
    redoStack:[], // array to hold redo xml trees
    current_xml:null, // holds current blockly workspace tree
    blockCount:0,   // how many blocks are there?
    yesthis:0,      // has there been a real change we should undo?
    fieldChanging:0,  // was the last change a field change?  For grouping field changes
    blockIds:[],    // parsed field ids
    fieldValues:[], // parsed field values
    parentIds:[],
    oldBlockIds:[],
    oldFieldValues:[],
    oldParentIds:[],
    just_did_undo:0
  };

  // Set up an event listener to see when the Blockly workspace gets a change
  // TODO: Set up some "Undo_events" in Blockly that only trigger on the good stuff
  Blockscad.workspace.addUndoListener(Blockscad.workspaceChanged);

    // test to see if a user is logged in - use this to populate the login-area.
  Blockscad.Auth.checkForUser();

  // pop up about popup
  $('#help-menu').on('click', '#about', function() {
    $('#about-modal').modal('show');
  });


}; // end Blockscad.init()

// Load Blockly's language strings.
document.write('<script src="blockly/msg/js/' + BSUtils.LANG + '.js"></script>\n');

// on page load, call blockscad init function.
window.addEventListener('load', Blockscad.init);


// Start a new project (save old project to account if logged in, clear blocks, clear rendered view)
Blockscad.newProject = function() {
  // should I prompt a save here?  If I have a current project, I should just save it?  Or not?
  // if the user is logged in, I should auto-save to the backend.
  if (Blockscad.undo.undoStack.length > 0) {
    if (Blockscad.Auth.isLoggedIn) { 
        Blockscad.Auth.saveBlocksToAccount();
        Blockscad.clearProject();
    }
    else {
      // I'm going to ask if they really want to delete their current work.
      // the modal's "yes, throw it away" button will actually do the deleting.
      $('#delete-confirm').modal('show');
    }
  }
  else Blockscad.clearProject();

  // if the user was on the code tab, switch them to the blocks tab.
  $('#displayBlocks').click();
}

Blockscad.clearProject = function() {

    // now I should make the new project.
  Blockscad.Auth.currentProject = '';
  Blockscad.Auth.currentProjectKey = '';
  Blockly.mainWorkspace.clear();
  gProcessor.clearViewer();  
  Blockscad.workspaceChanged();

  // clear the undo and redo stacks
  while(Blockscad.undo.undoStack.length) {
    Blockscad.undo.undoStack.pop();
  }
  while(Blockscad.undo.redoStack.length){
    Blockscad.undo.redoStack.pop();
  }

  $('#project-name').val('Untitled');
  $('#projectView').hide();
  $('#editView').show();
}



/**
 * Discard all blocks from the workspace.
 */
Blockscad.discard = function() {
  var count = Blockly.mainWorkspace.getAllBlocks().length;
  if (count < 2 ||
      window.confirm("Delete all " + count + " blocks?")) {
    Blockly.mainWorkspace.clear();
    window.location.hash = '';
  }
};

/* reset the rendering view */

Blockscad.resetView = function() {
  if (gProcessor) {
    if (gProcessor.viewer) {
      gProcessor.viewer.viewReset();
    }
  } 
}

// check for if there are both 2D and 3D shapes to be rendered
Blockscad.mixes2and3D = function() {
  var topBlocks = [];
  topBlocks = Blockly.mainWorkspace.getTopBlocks(); 
  var hasCSG = 0;
  var hasCAG = 0;
  var hasUnknown = 0;
  var hasShape = 0;   // assignTypes isn't firing after page load

  for (var i = 0; i < topBlocks.length; i++) {
    if (Blockscad.stackIsShape(topBlocks[i])) { 
      hasShape = 1;
      var cat = topBlocks[i].category;

      if (cat == 'PRIMITIVE_CSG') hasCSG++;
      if (cat == 'PRIMITIVE_CAG') hasCAG++;
      if (cat == 'TRANSFORM' || cat == 'SET_OP') {
        var mytype = topBlocks[i].getInput('A').connection.check_;
        if (mytype.length == 1 && mytype[0] == 'CSG') hasCSG++;
        if (mytype.length == 1 && mytype[0] == 'CAG') hasCAG++;
      }  
      if (cat == 'LOOP') {
        var mytype = topBlocks[i].getInput('DO').connection.check_;
        if (mytype.length == 1 && mytype[0] == 'CSG') hasCSG++;
        if (mytype.length == 1 && mytype[0] == 'CAG') hasCAG++;
      }
      if (cat == 'PROCEDURE') {
        var mytype = topBlocks[i].myType_;
        if (mytype && mytype == 'CSG') hasCSG++;
        if (mytype && mytype == 'CAG') hasCAG++;
      }
      if (cat == 'COLOR') hasCSG++;
      if (cat == 'EXTRUDE') hasCSG++;
      if (topBlocks[i].type == 'controls_if') hasUnknown++;
    }
  }
  if (hasShape && !(hasCSG + hasCAG + hasUnknown)) {
    // assign types needs to be called here.  
    // console.log("assignTypes needed - why?");
    Blockscad.assignBlockTypes(Blockly.mainWorkspace.getTopBlocks());
  }
  return [(hasCSG && hasCAG), hasShape];
}

Blockscad.doRender = function() {
  // First, lets clear any old error messages.
  $( '#error-message' ).text("");
  $( '#error-message' ).removeClass("has-error");

  // if there are objects to render, I'm going to want to disable the render button!
  $('#renderButton').prop('disabled', true); 

  // Clear the previously rendered model
  gProcessor.clearViewer();

  var mixes = Blockscad.mixes2and3D();

  if (mixes[1] == 0) { // doesn't have any CSG or CAG shapes at all!
    $( '#error-message' ).text("Error: Nothing to Render");
    $( '#error-message' ).addClass("has-error");
    // HACK: file load is too slow - if user tries to render during file load
    // they get the "no objects to render" message.  Enable the render button.
    //$('#renderButton').prop('disabled', false); 
    return;
  }




  if (mixes[0]) {    // has both 2D and 3D shapes
    $( '#error-message' ).text("Error: both 2D and 3D objects are present.  There can be only one.");
    $( '#error-message' ).addClass("has-error");
    return;
  }





  Blockscad.missingFields = [];
  var code = Blockly.OpenSCAD.workspaceToCode(Blockscad.workspace);

  if (Blockscad.missingFields.length > 0) {
    // highlight the missing blocks, set up/display the correct error message
    for (var i = 0; i < Blockscad.missingFields.length; i++) {
      var blk = Blockly.mainWorkspace.getBlockById(Blockscad.missingFields[i]);
      blk.unselect();
      blk.backlight();
      // if block is in a collapsed parent, highlight collapsed parent too
      var others = blk.collapsedParents();
      if (others)
        for (var j=0; j < others.length; j++) { 
          others[j].unselect();
          others[j].backlight();  
        }
    }
    $( '#error-message' ).text("ERROR: " + Blockscad.missingFields.length + 
                            " blocks have empty fields.");
    $( '#error-message' ).addClass("has-error");
    return;
  }
  var code_good = true;
  try {
   $('#renderButton').html('working'); 
   window.setTimeout(function (){ code = openscadOpenJscadParser.parse(code) }, 0);
  }
  catch(err) {
    $( '#error-message' ).text(err);
    $( '#error-message' ).addClass("has-error");
    code_good = false;
  }
  if (code_good) {
    window.setTimeout(function () { gProcessor.setJsCad(code) }, 0);
    // TO-DO - make sure the rendering actually worked?
  }
  else {
    $('#renderButton').html('Render'); 

  }


  // turns out rendering is asynchronus.  
  //I should go to the end of the render (in openjscad.js) and turn this stuff off.
 // if (!(Blockscad.selected == 'render')) {
 //     gProcessor.disableItems();
 // }
}
 

// Blockscad.isRealChange is called from Blockscad.workspaceChanged to see if
// the changes should count as "undoable" or should be ignored.
// return == true means that it is a real change.
// return == false means it is ignorable.
// it checks for block deletion, block insertion, block connecting,
// block disconnecting, and collects field changes.
// each possible "is_real" condition is separate (like block insert vs. delete)
// to make it easier to configure the undo - what events trigger a real undo?

Blockscad.isRealChange = function() {
  // set up the info we need to determine a change
  //time to parse block info.  Get ID's, parent ID's, and field values.
  Blockscad.undo.blockIds = [];
  Blockscad.undo.parentIds = [];
  Blockscad.undo.fieldValues = [];
  Blockscad.undo.isDisabled = [];
  var deletedBlockPos = null;
  var addedBlockPos = null;
  var deletedBlockParent = null;
  var addedBlockParent = null;

  // console.log("in isRealChange with current",Blockscad.undo.blockList);
  // console.log("old at RealChange",Blockscad.undo.oldBlockList);

  // save field values, ids, and parent ids, and disabled state for all blocks in workspace.

  // if a procedure call block has been added, it will have an UNKNOWN type.
  // populate its type.
  for (var i = 0; i < Blockscad.undo.blockList.length; i++) {
    Blockscad.undo.fieldValues[i] = Blockscad.undo.blockList[i].getAllFieldValues();
    Blockscad.undo.blockIds[i] = Blockscad.undo.blockList[i].id;
    Blockscad.undo.isDisabled[i] = Blockscad.undo.blockList[i].disabled;
    if (Blockscad.undo.blockList[i].getParent())
      Blockscad.undo.parentIds[i] = Blockscad.undo.blockList[i].getParent().id;
    else Blockscad.undo.parentIds[i] = null;
    if (Blockscad.undo.blockList[i].category) {
      if (Blockscad.undo.blockList[i].category == 'UNKNOWN') {
        Blockscad.undo.blockList[i].getType();
      }
    }
  }

  // has the number of blocks decreased, or increased?
  if (Blockscad.undo.blockCount > Blockscad.undo.blockList.length) {
    // this is the "block deleted" condition
    Blockscad.undo.fieldChanging = 0;
    // were all the blocks deleted?
    if (Blockscad.undo.blockList.length == 0) {
      // All blocks were deleted.  An undo would have to restore current.xml here.
    }
    else {
      deletedBlockPos = Blockscad.getExtraRootBlock(Blockscad.undo.oldBlockList, Blockscad.undo.blockList);
      //console.log("got the deleted block postion at",deletedBlockPos);
      var oldParentID = Blockscad.undo.oldParentIds[deletedBlockPos]; 
      deletedBlockParent = Blockscad.getBlockFromId(oldParentID,Blockscad.undo.blockList);
      if (deletedBlockParent) Blockscad.assignBlockTypes([deletedBlockParent]);
    }
    return true;
  }
  if (Blockscad.undo.blockCount < Blockscad.undo.blockList.length) {
    // A block has been added here.  Get the new block.  If it has a category,
    // send it to assignBlockTypes.  (might want to get parent too for undo?)
    Blockscad.undo.fieldChanging = 0;
    if (Blockscad.undo.oldBlockList.length == 0) {
      // We just refreshed, loaded
      Blockscad.assignBlockTypes(Blockly.mainWorkspace.getTopBlocks());
 //     console.log("whole workspace refreshed");
    }
    else {
      //console.log("a block was added");
      addedBlockPos = Blockscad.getExtraRootBlock(Blockscad.undo.oldBlockList, Blockscad.undo.blockList);
      Blockscad.assignBlockTypes([Blockscad.undo.blockList[addedBlockPos]]);
    }
    return true;
  }

  // I need to go through the blocks.  First, I'll check for blocks having different parents.
  // I speculate that these are mainly plug/unplug events.  Is that true?
  // on a plug/unplug event I run enableMathBlocks in case a math block was 
  // plugged into something and needs to be enabled again.

  // after checking parents I check for field values changing.
  // console.log("blockIds",Blockscad.undo.blockIds);
  // console.log("oldBlockIds",Blockscad.undo.oldBlockIds);
  // console.log("parentIds",Blockscad.undo.parentIds);
  // console.log("oldParentIds",Blockscad.undo.oldParentIds);
  for (var i = 0; i < Blockscad.undo.blockIds.length; i++) {
    var myid = Blockscad.undo.blockIds[i];
    var found_it = 0;
    var disable_change = false;
    for (var j = 0; j < Blockscad.undo.blockIds.length; j++) {
      if (myid == Blockscad.undo.oldBlockIds[j]) {
        found_it = 1;

        if (Blockscad.undo.parentIds[i] != Blockscad.undo.oldParentIds[j]) {
          Blockscad.enableMathBlocks(Blockscad.undo.blockList[i]);

          // determine if we had a "plug" or an "unplug" event, and 
          // send either one or two stacks to get types evaluated.
          // Note:  one event can be both a "plug" and an "unplug" event.
          //console.log("plug or unplug - send block myid",myid);
          Blockscad.assignBlockTypes([Blockscad.undo.blockList[i]]);
          for (var k = 0, blk; blk = Blockscad.undo.blockList[k]; k++) {
            if (blk.id == Blockscad.undo.oldParentIds[j]) {
              //console.log("unplugged parent exists with id",blk.id);
              Blockscad.assignBlockTypes([Blockscad.undo.blockList[k]]);
              Blockscad.enableMathBlocks(Blockscad.undo.blockList[k]);
              break;
            }
          }
          return true; // found a real change - a plug/unplug event!
        }
        if (Blockscad.undo.fieldValues[i] != Blockscad.undo.oldFieldValues[j]) {
          // A field is changing.  I won't trigger undo yet to aggregate
          // the keypresses, but I do want to enable the renderButton already.
          $('#renderButton').prop('disabled', false); 
          if (Blockscad.undo.fieldChanging != myid) {
            Blockscad.undo.fieldChanging = myid;
            return true; // found a real change - a field is changing!
          }
          else return false; // this event should be ignored by undo.
        }
        if (Blockscad.undo.isDisabled[i] != Blockscad.undo.oldDisabled[j]) {
          // some block has changed from disabled to enabled, or vice-versa.  Mark this
          // as an undoable change.
          return true;
        }
      }

    }
    if (!found_it) {
      // this only happens after an undo when all block ids change
      // I'm not even sure I need to have this here - I think it's redundant
      //console.log("couldn't find a block id");
      //console.log(Blockscad.undo.blockIds,Blockscad.undo.oldBlockIds);
      return true;
    }
  }

  return false;
}// end Blockscad.isRealChange()

Blockscad.workspaceChanged = function () {

  Blockscad.undo.yesthis = 0;  // I don't know if this is a real change yet.
  //console.log("workspace has changed\n");
  // important - check to see if the change is one we want to make undoable!
  Blockscad.undo.blockList = Blockly.mainWorkspace.getAllBlocks();
  //console.log("here's the current blocks in the workspace:",Blockscad.undo.blockList); 

  Blockscad.undo.yesthis = Blockscad.isRealChange();

  //   Update all the change compare vars. for the next go round.
  Blockscad.undo.blockCount = Blockscad.undo.blockList.length;
  Blockscad.undo.oldBlockIds = Blockscad.undo.blockIds;
  Blockscad.undo.oldParentIds = Blockscad.undo.parentIds;
  Blockscad.undo.oldFieldValues = Blockscad.undo.fieldValues;
  Blockscad.undo.oldDisabled = Blockscad.undo.isDisabled;


//  Blockscad.undo.oldBlockList = Blockscad.undo.blockList;
 // console.log("do I have children?",Blockscad.undo.oldBlockList);

  Blockscad.checkMathOrphans();

  if (Blockscad.undo.yesthis) {
    //console.log("yesthis");
    // there has been a substantive change.  I need to update the
    // undo/redo stacks, and enable the render button.

    $('#renderButton').prop('disabled', false); 

    if (Blockscad.undo.just_did_undo) {
      // because the current undo/redo method can change all the block ids
      // I need to reassign block types to ALL BLOCKS afterwards (grr)
      Blockscad.assignBlockTypes(Blockly.mainWorkspace.getTopBlocks());
    }
    if (Blockscad.undo.just_did_undo == 0) {
      // push Blockscad.current_xml onto undo stack
      if (Blockscad.undo.current_xml != null) {
        Blockscad.undo.undoStack.push(Blockscad.undo.current_xml);
      }
      // refill current_xml with the new, changed, xml state
      Blockscad.undo.current_xml = Blockly.Xml.workspaceToDom(Blockly.getMainWorkspace());

      // clear redo list
      while(Blockscad.undo.redoStack.length > 0) {
        Blockscad.undo.redoStack.pop();
      }
      // if undo.length > (some number - 50?), shift off the first element
      if (Blockscad.undo.undoStack.length > 50) {
        Blockscad.undo.undoStack.shift();
      }
    }
  }
  // even though this isn't a real change, I want to accumulate moves
  // and field changes in the current state, which will then be pushed
  // to the undo stack after a "real" change.
  // refill current_xml with the new, changed, xml state
  Blockscad.undo.current_xml = Blockly.Xml.workspaceToDom(Blockly.getMainWorkspace());
  // copy all the blocks from blockList into oldBlockList (DOM format)
  Blockscad.undo.oldBlockList = [];
  for (var i = 0; i < Blockscad.undo.blockList.length; i++) {
    Blockscad.undo.oldBlockList.push(Blockly.Xml.blockToDom_(Blockscad.undo.blockList[i]));
  }
  //console.log("old blocklist as dom at the end of workspace_changed", Blockscad.undo.oldBlockList);
  //console.log("just_did_undo = 0");
  Blockscad.undo.just_did_undo = 0;

  // should the undo or redo buttons be active?
  if (Blockscad.undo.undoStack.length > 0) {
    $('#undoButton').prop('disabled', false);  
  }
  else {
    $('#undoButton').prop('disabled', true);  
  }
  if (Blockscad.undo.redoStack.length > 0) {
    $('#redoButton').prop('disabled', false);  
  }
  else {
    $('#redoButton').prop('disabled', true);  
  }
} // end workspaceChanged()
Blockscad.getExtraRootBlock = function(old,current) {
  //console.log("starting getExtraRootBlock");
  var gotOne = 0;
  var foundIt = [];
  //console.log("old",old);
  //console.log("current",current);

  // go through the longer list, whichever it is.  
  // for each element of the longer list, go through
  // all elements of the shorter array.  At each position,
  // compare block ids.  

  if (old.length > current.length) {
    for (var i=0; i < old.length; i++) {
      gotOne = 0;
      for (var j = 0; j < current.length; j++) {
        // compare block ids.  Have we found a match for the first list?
        if (old[i].getAttribute('id') == current[j].id) {
          // found a match.  Save the id, and break out.
          gotOne = 1;
          break;
        }
      }
      if (!gotOne)
        return i;
    }
  }
  else {
    for (var i=0; i < current.length; i++) {
      gotOne = 0;
      for (var j = 0; j < old.length; j++) {
        // compare block ids.  Have we found a match for the first list?
        if (current[i].id == old[j].getAttribute('id')) {
          // found a match.  Save the id, and break out.
          gotOne = 1;
          break;
        }
      }
      if (!gotOne)
        return i;
    }
  }
  // console.log("getExtraRootBlock failed!");
  return 0;  // this should never happen
} // end getExtraRootBlock()

// this get block from id function searches a given list of blocks, 
// instead of the blocks in the main workspace.  Needed for typing.
Blockscad.getBlockFromId = function(id, blocks) {
  for (var i = 0, block; block = blocks[i]; i++) {
    if (block.id == id) {
      return block;
    }
  }
  return null;
};

Blockscad.onUndo = function() {
  //console.log("Undo button activated!");
  //  if undo stack has anything on it
  if (Blockscad.undo.undoStack.length > 0) {
    // lets gray out the button!
    //var btn = document.getElementById("undoButton");
    //btn.disabled = true;
    //console.log(btn);
    //btn.setAttribute('class','gray');

    //setTimeout(function() {
        //long running task here
            // push Blockscad.current_xml onto redo stack
    Blockscad.undo.redoStack.push(Blockscad.undo.current_xml);
    // pop undo stack into current_xml
    Blockscad.undo.current_xml = Blockscad.undo.undoStack.pop();
    // set actual workspace code to current_xml (I need to clear it first?)
    // this isn't working.  Scope issues.  Argh.
    //console.log("clearing workspace");
    Blockly.mainWorkspace.clear();
    //console.log("loading workspace");

    Blockly.Xml.domToWorkspace(Blockly.getMainWorkspace(), Blockscad.undo.current_xml);
    //console.log("rendering workspace");
    // trigger re-render
    Blockly.mainWorkspace.render();
    //console.log("done");
    Blockscad.undo.just_did_undo = 1;
    //console.log("just_did_undo = 1");
    //btn.setAttribute('class','gray');
    //btn.disabled = false;

   //}, 0);


  }
} // end onUndo()

Blockscad.onRedo = function() {
  //console.log("Redo button activated!\n");
  // if redo stack has anything on it
  if (Blockscad.undo.redoStack.length > 0) {
    // push current_xml onto undo
    Blockscad.undo.undoStack.push(Blockscad.undo.current_xml);
    // pop redo stack into current_xml
    Blockscad.undo.current_xml = Blockscad.undo.redoStack.pop();
    // set workspace xml to current xml (do I need to clear it first?)
    Blockly.mainWorkspace.clear();
    Blockly.Xml.domToWorkspace(Blockly.getMainWorkspace(), Blockscad.undo.current_xml);
    // trigger re-render
    Blockly.mainWorkspace.render();
    Blockscad.undo.just_did_undo = 1;
    //console.log("just_did_undo = 1");
  }
} // end onRedo()

// disable any math or logic or variable blocks sitting around onthe workspace.
Blockscad.checkMathOrphans = function() {
  var topBlocks = [];
  topBlocks = Blockly.mainWorkspace.getTopBlocks();

  for (var i = 0; i < topBlocks.length; i++) {
    // my current block topBlocks[i]
    // is a top block a math or logic or variable block?  Disable it.
    //console.log(topBlocks[i].type);
    if ((topBlocks[i].type.lastIndexOf('math') != -1) ||
      (topBlocks[i].type.lastIndexOf('variables_get') != -1) ||
      (topBlocks[i].type.lastIndexOf('logic') != -1)) {
      topBlocks[i].setDisabled(true);
    }
  }
} // end checkMathOrphans()

// enable any disabled math blocks in an enabled parent.
// sometimes we'll be sent a parent block, and need to check its children.
Blockscad.enableMathBlocks = function(block) {
  var blockStack = block.getDescendants();
  for (var i = 0; i < blockStack.length; i++) {
    if (blockStack[i].disabled) {
      if ((blockStack[i].type.lastIndexOf('math') != -1) ||
         (blockStack[i].type.lastIndexOf('variables_get') != -1) ||
         (blockStack[i].type.lastIndexOf('logic') != -1)) {
        var par;
        if (par = blockStack[i].getParent()) {
          //console.log("enabling children",children);
          if (!par.disabled)  
              blockStack[i].setDisabled(false);
        }
      }
    }
  }
}

Blockscad.aCallerBlock = function(block, callers) {
  for (var i = 0; i < callers.length; i++)
    if (block == callers[i]) return true;
  return false;
} // end Blockscad.aCallerBlock

// have a single block, and want to find out what type it's stack makes it?
// This is for procedure call block typing.

Blockscad.findBlockType = function(block, callers) {
  var topBlock = block.getRootBlock();
  var blockStack = topBlock.getDescendants();
  var foundCSG = 0;
  var foundCAG = 0;

  // when I check the types of the surrounding blocks,
  // I DON'T want to count procedure calling blocks 
  // that are from the same procedure definition as "block".
  for (var j = 0; j < blockStack.length; j++) {
    if (!Blockscad.aCallerBlock(blockStack[j],callers) && blockStack[j].category) {
      var cat = blockStack[j].category;
      if (cat == 'PRIMITIVE_CSG' || cat == 'EXTRUDE' || cat == 'COLOR') {
        foundCSG = 1;
        break;
      }
      if (cat == 'PRIMITIVE_CAG') foundCAG = 1;
    }
  }
  //console.log("in findBlockAreaType with", blockStack);
  if (foundCSG) {
    if (Blockscad.hasExtrudeParent(block)) 
      return 'CAG';
    else return 'CSG';
  }
  else if (foundCAG) {
    return('CAG');
  }
  else return('EITHER');
}

// is this block attached to an actual primitive (2D or 3D)?  Needed for missing fields calc.
// if the block has a disabled parent, it won't be rendered and doesn't count.
Blockscad.stackIsShape = function(block) {
  var blockStack = block.getDescendants();
  for (var i = 0; i < blockStack.length; i++) {
    var blk = blockStack[i];
    // console.log(blk);
    // console.log(blk.disabled);
    if ((blk.category == 'PRIMITIVE_CSG' || blk.category == 'PRIMITIVE_CAG') && !blk.hasDisabledParent())
      return true;
  }
  return false;
}

// Blockscad.assignBlockTypes
// input: array of blocks whose trees need typing
Blockscad.assignBlockTypes = function(blocks) {
  for (var i=0; i < blocks.length; i++) {
    var topBlock = blocks[i].getRootBlock();
    var blockStack = topBlock.getDescendants();
    var foundCSG = 0;
    var foundCAG = 0;

    for (var j = 0; j < blockStack.length; j++) {
      if (blockStack[j].category) {
        var cat = blockStack[j].category;
        if (cat == 'PRIMITIVE_CSG' || cat == 'EXTRUDE' || cat == 'COLOR') {
          foundCSG = 1;
          break;
        }
        if (cat == 'PRIMITIVE_CAG') foundCAG = 1;
      }
    }

    // For assigning types, use the following algorithm:
    // Go down the list of blocks.  if foundCSG:
    //    if block has an EXTRUDE parent, set to CAG, otherwise CSG
    //    else if found CAG, set to CAG
    //    else set to EITHER.


    for(j = 0; j < blockStack.length; j++) {
      if (blockStack[j].category)
        if (blockStack[j].category == 'TRANSFORM' || 
            blockStack[j].category == 'SET_OP' ||
            blockStack[j].category == 'PROCEDURE' ||
            blockStack[j].category == 'LOOP')  {
          var drawMe = !blockStack[j].collapsedParents();
          //console.log(blockStack[j].type,"drawMe is", drawMe);
          if (foundCSG) {
            if (Blockscad.hasExtrudeParent(blockStack[j])) 
              blockStack[j].setType('CAG',drawMe);
            else blockStack[j].setType('CSG',drawMe);
          }
          else if (foundCAG) {
            blockStack[j].setType('CAG',drawMe);
          }
          else blockStack[j].setType(['CSG','CAG'],drawMe);
        }
    }
    //console.log("in assignBlockTypes(foundCSG,foundCAG)",foundCSG,foundCAG);
    //console.log("blockStack",blockStack);
  }
}
Blockscad.hasExtrudeParent = function(block) {
  do {
    if (block.category == 'EXTRUDE')
      return true;
    block = block.parentBlock_;
  } while (block);
  return false;
}


// -- BEGIN OPENJSCAD STUFF --

function putSourceInEditor(src,fn) {
   editor.setValue(src); 
   editor.clearSelection();
   editor.navigateFileStart();

   previousFilename = fn;
   previousScript = src;
   gPreviousModificationTime = "";
}

/**
 * Initialize the page language.
 */
Blockscad.initLanguage = function() {
  // Set the HTML's language and direction.
  // document.dir fails in Mozilla, use document.body.parentNode.dir instead.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=151407
  var rtl = BSUtils.isRtl();
  document.head.parentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  document.head.parentElement.setAttribute('lang', BSUtils.LANG);

  // Sort languages alphabetically.
  var languages = [];
  for (var lang in BSUtils.LANGUAGE_NAME) {
    languages.push([BSUtils.LANGUAGE_NAME[lang], lang]);
  }
  var comp = function(a, b) {
    // Sort based on first argument ('English', 'Русский', '简体字', etc).
    if (a[0] > b[0]) return 1;
    if (a[0] < b[0]) return -1;
    return 0;
  };
  languages.sort(comp);
  // Populate the language selection menu.
  var languageMenu = document.getElementById('languageMenu');
  languageMenu.options.length = 0;
  for (var i = 0; i < languages.length; i++) {
    var tuple = languages[i];
    var lang = tuple[tuple.length - 1];
    var option = new Option(tuple[0], lang);
    if (lang == BSUtils.LANG) {
      option.selected = true;
    }
    languageMenu.options.add(option);
  }
  languageMenu.addEventListener('change', BSUtils.changeLanguage, true);

  // var categories = ['catLogic', 'catLoops', 'catMath', 
  //                   'catVariables', 'catFunctions'];
  // for (var i = 0, cat; cat = categories[i]; i++) {
  //   document.getElementById(cat).setAttribute('name', MSG[cat]);
  // }
  // var textVars = document.getElementsByClassName('textVar');
  // for (var i = 0, textVar; textVar = textVars[i]; i++) {
  //   textVar.textContent = MSG['textVariable'];
  // }
  // var listVars = document.getElementsByClassName('listVar');
  // for (var i = 0, listVar; listVar = listVars[i]; i++) {
  //   listVar.textContent = MSG['listVariable'];
  // }
};
/**
 * Save the workspace to an XML file.
 */
Blockscad.saveBlocksLocal = function() {
  var xmlDom = Blockly.Xml.workspaceToDom(Blockly.getMainWorkspace());
  var xmlText = Blockly.Xml.domToText(xmlDom);
  var blob = new Blob([xmlText], {type: "text/plain;charset=utf-8"});

  // pull a filename entered by the user
  var blocks_filename = $('#project-name').val();
  // don't save without a filename.  Name isn't checked for quality.
  if (blocks_filename) {
    saveAs(blob, blocks_filename + ".xml");
  }
  else {
    alert("SAVE FAILED.  Please give your project a name, then try again.");
  }
}

