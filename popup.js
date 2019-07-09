function getCurrentTab(callback) {
    var queryInfo = {
        active: true,
        currentWindow: true
    };

    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        callback(tab);
    });
}

document.addEventListener('DOMContentLoaded', function () {
    console.log("Start loading safari book info");
    $('#download-section').hide();
    $('#book-info').hide();
    $('#error-message').hide();
    let bookInfo = new BookInfo();
})

class BookInfo {
    constructor() {
        getCurrentTab((tab) => {
            this.bookId = this.getBookId(tab.url);
            this.chapters = [];
            this.render();
        });
    }

    // for capture to image

    getFilename(contentURL) {
        var name = contentURL.split('?')[0].split('#')[0];
        if (name) {
            name = name
                .replace(/^https?:\/\//, '')
                .replace(/[^A-z0-9]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^[_\-]+/, '')
                .replace(/[_\-]+$/, '');
            name = '-' + name;
        } else {
            name = '';
        }
        return 'screencapture' + name + '-' + Date.now() + '.png';
    }


//
// Capture Handlers
//


    displayCaptures(filenames) {
        if (!filenames || !filenames.length) {
            show('uh-oh');
            return;
        }

        _displayCapture(filenames);
    }


    _displayCapture(filenames, index) {
        index = index || 0;

        var filename = filenames[index];
        var last = index === filenames.length - 1;

        if (currentTab.incognito && index === 0) {
            // cannot access file system in incognito, so open in non-incognito
            // window and add any additional tabs to that window.
            //
            // we have to be careful with focused too, because that will close
            // the popup.
            chrome.windows.create({
                url: filename,
                incognito: false,
                focused: last
            }, function(win) {
                resultWindowId = win.id;
            });
        } else {
            chrome.tabs.create({
                url: filename,
                active: last,
                windowId: resultWindowId,
                openerTabId: currentTab.id,
                index: (currentTab.incognito ? 0 : currentTab.index) + 1 + index
            });
        }

        if (!last) {
            _displayCapture(filenames, index + 1);
        }
    }


    errorHandler(reason) {
        show('uh-oh'); // TODO - extra uh-oh info?
    }


    progress(complete) {
        if (complete === 0) {
            // Page capture has just been initiated.
            show('loading');
        }
        else {
            $('bar').style.width = parseInt(complete * 100, 10) + '%';
        }
    }


    splitnotifier() {
        show('split-image');
    }

    //----------------------------------------------------------------------------------

    get(url) {
        return fetch(url, {
            credentials: 'include'
        }).then((res) => {
            return res.json()
        })
    }

    render() {
        if (this.bookId != null) {
            this.getBookInfo()
                .then((info) => {
                    this.bookInfo = info
                })
                .then(() => {
                    $('#loading').hide();

                    if (this.bookInfo.title == null) {
                        $('#error-message').text("I'm not able to get the book title, please check if you have logged in with a *valid* account. \n A valid account means you can load and read the full book. \nIf you are sure you have logged in, please report this incidence to: \nhttps://github.com/chenditc/safari-download/issues");
                        $('#error-message').show();
                        return;
                    }

                    // Book info section
                    $("#book-info-notice").text("You are about to download:");
                    $("#book-name").text(this.bookInfo.title);
                    $("#book-cover").attr("src", this.bookInfo.cover);
                    $('#book-info').show();

                    let chapter_list_url = `https://learning.oreilly.com/api/v1/book/${this.bookId}/chapter/`
                    this.getChapterList(chapter_list_url)
                        .then((chapters) => this.fetchChapterList(chapters))
                        .then(() => this.renderChapterList());

                    // Download section
//          $('#download-button').click(() => {
//                console.log("start downloading book");
//                this.downloadChapters()
//                      .then((chapters) => { return this.zipChapters(chapters) })
//                      .then((zip) => { return this.downloadFile(zip) })
//             });
                    $('#download-button').click(() => {
                        console.log("start downloading book");
                        $("#download-warning").text("Downloading chapters, please don't close the popup.");
                        $("#download-warning").show()
                        this.downloadSelectedChapters()
                            .then((chapters) => {
                                return this.zipChapters(chapters)
                            })
                            .then((zip) => {
                                return this.downloadFileAsZip(zip)
                            });
                    });
                    $('#download-section').show();
                })
        } else {
            var obj = $('#error-message').text('This is not a webpage we support,\n only domain "learning.oreilly.com" is supported. \nPlease check your url is in the form of: \n"https://learning.oreilly.com/library/view/{bookname}/{numbers}/..."');
            obj.html(obj.html().replace(/\n/g, '<br/>'));
            $('#error-message').show();
            $('#loading').hide();
        }
    }

    // gets the book id from the url - when you have a chapter open, this is
    // available in the `window.g` object, but not if you're on the book
    // description page
    getBookId(url) {
        // match a url like:
        // https://learning.oreilly.com/library/view/startup-opportunities-2nd/9781119378181/
        // https://learning.oreilly.com/library/view/startup-growth-engines/77961SEM00001/
        let match = url.match(/\/library\/view\/[^\/]+\/(\w+)\//)
        let bookId = match && match[1]

        if (!bookId) {
            console.log('could not extract book id from url, only domain "learning.oreilly.com“ is supported.');
            return null;
        }

        return bookId
    }

    downloadSelectedChapters() {
        // Traverse all chapters and get a list of selected chapter
        var chapter_dom_list = $("#book-chapter-list").find("li");
        var selected_chapters = [];

        for (var chapter_dom_index = 0;
             chapter_dom_index < chapter_dom_list.length;
             chapter_dom_index++) {
            var chapter_dom = chapter_dom_list[chapter_dom_index];
            var checkbox = $(chapter_dom).children().get(0);
            if (checkbox.checked) {
                var chapter_index = $(chapter_dom).attr("chapterIndex");
                var chapter_info = this.chapters[parseInt(chapter_index)];
                chapter_info.chapterIndex = chapter_dom_index;
                selected_chapters.push(chapter_info);
            }
        }

        // download these chapters
        return Promise.map(selected_chapters, (chapterInfo) => {
            return this.downloadChapter(chapterInfo)
        }, {concurrency: 10})
    }

    getBookInfo() {
        let url = `https://learning.oreilly.com/api/v1/book/${this.bookId}/`
        return fetch(url, {
            credentials: 'include'
        }).then((res) => {
            return res.json()
        })
    }

    getChapterList(chapter_list_url) {
        let url = chapter_list_url;
        return fetch(url, {
            credentials: 'include'
        }).then((res) => {
            return res.json()
        })
    }

    fetchChapterList(chaptersResult) {
        let next_chapter_list_url = chaptersResult.next;
        let chapter_list = chaptersResult.results;
        this.chapters = this.chapters.concat(chapter_list);

        if (next_chapter_list_url != null) {
            return this.getChapterList(next_chapter_list_url)
                .then((chapters) => this.fetchChapterList(chapters));
        } else {
            // Finish fetching all chapters
            $("#loading-chapter-list")[0].innerText = "All chapters loaded."
            // Add select all button callback
            $('#select-all-button').click(() => {
                console.log("Select all");
                $('input:checkbox').prop('checked', true);
            });
            $('#select-all-button').show();
            $('#deselect-all-button').click(() => {
                console.log("Select all");
                $('input:checkbox').prop('checked', false);
            });
            $('#deselect-all-button').show()
            $('#download-button').show()
        }
    }

    renderChapterList() {
        // Add chapters to UI
        for (var chapter_num in this.chapters) {
            console.log(this.chapters[chapter_num])
            var chapter = this.chapters[chapter_num];
            var chapter_dom = $("<li></li>")
                .addClass("list-group-item")
                .html("<input type=\"checkbox\" checked>" + chapter.title)
                .attr("chapterIndex", chapter_num);
            $("#book-chapter-list").append(chapter_dom);
        }
    }

    downloadChapters() {
        console.log(Promise);
        return Promise.map(this.bookInfo.chapters, (url) => {
            return this.downloadChapter(url)
        }, {concurrency: 10})
    }

    downloadChapter(chapterInfo) {
        return this.capturePage(chapterInfo.web_url).then((png) => {
            let name = chapterInfo.filename;
            let chapterNum = ('00000' + chapterInfo.chapterIndex.toString()).slice(-3)
            name = "ch" + chapterNum + "-" + name;
            return {
                name: name,
                png: png
            }
        })
    }

    capturePage(url) {
        let tabId = null
        return new Promise((resolve) => {
            chrome.tabs.create({url: url, active: false}, resolve)
        }).then((tab) => {
            tabId = tab.id
            return new Promise((resolve) => {
                function listener(_tabId, changeInfo) {
                    if (tabId == _tabId && changeInfo.status == 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener)
                        resolve()
                    }
                }

                chrome.tabs.onUpdated.addListener(listener)
            })
        }).then((tab) => {
            console.log(tab)
            return new Promise((resolve) => {
                //chrome.pageCapture.saveAsMHTML({tabId: tabId}, resolve)
                // CaptureAPI.captureToFiles(tab, this.getFilename(tab.url), this.displayCaptures,
                //     this.errorHandler, this.progress, this.splitnotifier);
            })
        }).then((image) => {
            chrome.tabs.remove(tabId)
            return image
        })
    }

    zipChapters(chapters) {
        $("#download-warning").text("Zipping chapters, please don't close the popup.");
        let zip = new JSZip();
        chapters.forEach((chapter) => {
            zip.file(chapter.name, chapter.mhtml)
        })
        return zip.generateAsync({type: 'blob'})
    }

    downloadFileAsZip(file) {
        $("#download-warning").text("Downloading zip file, please don't close the popup.");
        let filename = this.bookInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".zip"
        let url = window.URL.createObjectURL(file)

        chrome.downloads.download({"filename": filename, url: url})

        $("#download-warning").text("All done.");
    }

}
