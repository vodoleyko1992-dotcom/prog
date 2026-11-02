function number_format(number, decimals) {
    number = (number + '').replace(/[^0-9+\-Ee.]/g, '');
    var n = !isFinite(+number) ? 0 : +number,
        prec = !isFinite(+decimals) ? 0 : Math.abs(decimals),
        sep = '.',
        dec = ',',
        s = '',
        toFixedFix = function (n, prec) {
            var k = Math.pow(10, prec);
            return '' + Math.round(n * k) / k;
        };
    // Fix for IE parseFloat(0.55).toFixed(0) = 0;
    s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
    if (s[0].length > 3) {
        s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
    }
    if ((s[1] || '').length < prec) {
        s[1] = s[1] || '';
        s[1] += new Array(prec - s[1].length + 1).join('0');
    }
    return s.join(dec);
}

function NumberGetHumanReadable(value, dec) {
    if (typeof dec === "undefined") {
        dec = 0;
    }
    if (dec == 0) {
        value = removeE(Math.floor(value));
    }
    return number_format(value, dec);
}

function shortly_number(number) {
    var unit = ["", "K", "M", "B", "T", "Q", "Q+", "S", "S+", "O", "N"];
    var negate = number < 0 ? -1 : 1;
    var key = 0;
    number = Math.abs(number);

    if (number >= 1000000) {
        ++key;
        while (number >= 1000000) {
            ++key;
            number = number / 1000000;
        }
    } else if (number >= 1000) {
        ++key;
        number = number / 1000;
    }

    decial = key != 0 && number != 0 && number < 100;
    return NumberGetHumanReadable(negate * number, decial) + (key !== 0 ? '&nbsp;' + unit[key] : '');
}

function removeE(Number) {
    Number = String(Number);
    if (Number.search(/e\+/) == -1)
        return Number;
    var e = parseInt(Number.replace(/\S+.?e\+/g, ''));
    if (isNaN(e) || e == 0)
        return Number;
    else if ($.browser.webkit || $.browser.msie)
        return parseFloat(Number).toPrecision(Math.min(e + 1, 21));
    else
        return parseFloat(Number).toPrecision(e + 1);
}

function getFormatedDate(timestamp, format) {
    var currTime = new Date();
    currTime.setTime(timestamp + (ServerTimezoneOffset * 1000));
    str = format;
    str = str.replace('[d]', dezInt(currTime.getDate(), 2));
    str = str.replace('[D]', days[currTime.getDay()]);
    str = str.replace('[m]', dezInt(currTime.getMonth() + 1, 2));
    str = str.replace('[M]', months[currTime.getMonth()]);
    str = str.replace('[j]', parseInt(currTime.getDate()));
    str = str.replace('[Y]', currTime.getFullYear());
    str = str.replace('[y]', currTime.getFullYear().toString().substr(2, 4));
    str = str.replace('[G]', currTime.getHours());
    str = str.replace('[H]', dezInt(currTime.getHours(), 2));
    str = str.replace('[i]', dezInt(currTime.getMinutes(), 2));
    str = str.replace('[s]', dezInt(currTime.getSeconds(), 2));
    return str;
}

function dezInt(num, size, prefix) {
    prefix = (prefix) ? prefix : "0";
    var minus = (num < 0) ? "-" : "",
        result = (prefix == "0") ? minus : "";
    num = Math.abs(parseInt(num, 10));
    size -= ("" + num).length;
    for (var i = 1; i <= size; i++) {
        result += "" + prefix;
    }
    result += ((prefix != "0") ? minus : "") + num;
    return result;
}

function getFormatedTime(time) {
    hours = Math.floor(time / 3600);
    timeleft = time % 3600;
    minutes = Math.floor(timeleft / 60);
    timeleft = timeleft % 60;
    seconds = timeleft;
    return dezInt(hours, 2) + ":" + dezInt(minutes, 2) + ":" + dezInt(seconds, 2);
}

function GetRestTimeFormat(Secs) {
    var s = Secs;
    var m = 0;
    var h = 0;
    if (s > 59) {
        m = Math.floor(s / 60);
        s = s - m * 60;
    }
    if (m > 59) {
        h = Math.floor(m / 60);
        m = m - h * 60;
    }
    return dezInt(h, 2) + ':' + dezInt(m, 2) + ":" + dezInt(s, 2);
}

function OpenPopup(target_url, win_name, width, height) {
    var new_win = window.open(target_url + '&ajax=1', win_name, 'scrollbars=yes,statusbar=no,toolbar=no,location=no,directories=no,resizable=no,menubar=no,width=' + width + ',height=' + height + ',screenX=' + ((screen.width - width) / 2) + ",screenY=" + ((screen.height - height) / 2) + ",top=" + ((screen.height - height) / 2) + ",left=" + ((screen.width - width) / 2));
    new_win.focus();
}

function DestroyMissiles() {
    $.getJSON('?page=information&mode=destroyMissiles&' + $('.missile').serialize(), function (data) {
        $('#missile_502').text(NumberGetHumanReadable(data[0]));
        $('#missile_503').text(NumberGetHumanReadable(data[1]));
        $('.missile').val('');
    });
}

function handleErr(errMessage, url, line) {
    error = "There is an error at this page.\n";
    error += "Error: " + errMessage + "\n";
    error += "URL: " + url + "\n";
    error += "Line: " + line + "\n\n";
    error += "Click OK to continue viewing this page,\n";
    alert(error);
    if (typeof console == "object")
        console.log(error);

    return true;
}

var Dialog = {
    info: function (ID) {
        return Dialog.open('game.php?page=information&id=' + ID, 700, (ID > 600 && ID < 800) ? 210 : ((ID > 100 && ID < 200) ? 300 : 620));
    },

    alert: function (msg, callback) {
        alert(msg);
        if (typeof callback === "function") {
            callback();
        }
    },

    PM: function (ID, Subject, Message) {
        if (typeof Subject !== 'string')
            Subject = '';

        return Dialog.open('game.php?page=messages&mode=write&id=' + ID + '&subject=' + encodeURIComponent(Subject) + '&message=' + encodeURIComponent(Subject), 650, 350);
    },

    Playercard: function (ID) {
        return Dialog.open('game.php?page=playerCard&id=' + ID, 650, 600);
    },

    Buddy: function (ID) {
        return Dialog.open('game.php?page=buddyList&mode=request&id=' + ID, 650, 300);
    },

    PlanetAction: function () {
        return Dialog.open('game.php?page=overview&mode=actions', 400, 180);
    },

    AllianceChat: function () {
        return OpenPopup('game.php?page=chat&action=alliance', "alliance_chat", 960, 900);
    },
    PayPal: function () {
        return Dialog.open('game.php?page=donatebis', 720, 400);
    }, 
    Payment: function () {
        return Dialog.open('game.php?page=PaymentOptions', 720, 400);
    },
    Refferal: function () {
        return Dialog.open('game.php?page=Refferal', 720, 400);
    },
    Bank: function () {
        return Dialog.open('game.php?page=BankTransfer', 720, 400);
    },
    Bitcoin: function () {
        return Dialog.open('game.php?page=Bitcoin', 720, 400);
    },
    Server: function () {
        return Dialog.open('game.php?page=Serverinfo', 720, 400);
    },


    open: function (url, width, height) {
        $.fancybox({
            width: width,
            padding: 0,
            height: height,
            type: 'iframe',
            href: url
        });

        return false;
    }
}

function NotifyBox(text) {
    tip = $('#tooltip')
    tip.html(text).addClass('notify').css({
        left: (($(window).width() - $('#leftmenu').width()) / 2 - tip.outerWidth() / 2) + $('#leftmenu').width(),
    }).show();
    window.setTimeout(function () { tip.fadeOut(1000, function () { tip.removeClass('notify') }) }, 500);
}


function UhrzeitAnzeigen() {
    $(".servertime").text(getFormatedDate(serverTime.getTime(), tdformat));
}


$.widget("custom.catcomplete", $.ui.autocomplete, {
    _renderMenu: function (ul, items) {
        var self = this,
            currentCategory = "";
        $.each(items, function (index, item) {
            if (item.category != currentCategory) {
                ul.append("<li class='ui-autocomplete-category'>" + item.category + "</li>");
                currentCategory = item.category;
            }
            self._renderItem(ul, item);
        });
    }
});

function openV(IDblock, IDopenV) {
    if (!$('.ach_menu li.' + IDblock).hasClass('active')) {
        $('.ach_menu li').removeClass('active');
        $('.ach_menu li.' + IDblock).addClass('active');
        $('.ach_content_box').hide();
        $('#' + IDblock).show();

        if (IDopenV != 'no')
            $.cookie("openV", IDopenV);
    }
}

$(function () {
    $('#drop-admin').on('click', function () {
        $.get('admin.php?page=logout', function () {
            $('.globalWarning').animate({
                'height': 0,
                'padding': 0,
                'opacity': 0
            }, function () {
                $(this).hide();
            });
        });
    });


    window.setInterval(function () {
        $('.countdown').each(function () {
            var s = $(this).data('time') - (serverTime.getTime() - startTime) / 1000;
            if (s <= 0) {
                $(this).text('-');
            } else {
                $(this).text(GetRestTimeFormat(s));
            }
        });
    }, 1000);

    $('#planetSelector').on('change', function () {
        document.location = '?' + queryString + '&cp=' + $(this).val();
    });

    UhrzeitAnzeigen();
    setInterval(UhrzeitAnzeigen, 1000);

    $("button#create_new_alliance_rank").click(function () {
        $("div#new_alliance_rank").dialog({
            draggable: false,
            resizable: false,
            modal: true,
            width: 760
        });

        return false;
    });
});


(function ($, window, document) {
  console.log('[buildlist.js] loaded');

  if (!$ || typeof $.fn === 'undefined') {
    console.warn('[buildlist.js] jQuery not found. Aborting.');
    return;
  }

  // ---------- helpers ----------
  function readStock() {
    const num = t => Number(String($(t).text()).replace(/[.\s,]/g, '')) || 0;
    return {
      901: num('#current_metal'),
      902: num('#current_crystal'),
      903: num('#current_deuterium'),
      911: num('#current_energy'),
      921: num('#current_darkmatter'),
    };
  }

  function shortFmt(n) {
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, '') + ' T';
    if (abs >= 1e9)  return (n / 1e9 ).toFixed(2).replace(/\.00$/, '') + ' B';
    if (abs >= 1e6)  return (n / 1e6 ).toFixed(2).replace(/\.00$/, '') + ' M';
    if (abs >= 1e3)  return (n / 1e3 ).toFixed(2).replace(/\.00$/, '') + ' K';
    return String(Math.round(n));
  }

  function prettyFmt(n) {
    if (typeof window.NumberGetHumanReadableFull === 'function') {
      return window.NumberGetHumanReadableFull(n);
    }
    try {
      return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
        .format(Math.round(n));
    } catch (e) {
      const s = String(Math.round(n));
      const neg = s[0] === '-';
      const body = neg ? s.slice(1) : s;
      const out = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return neg ? '-' + out : out;
    }
  }

  function sumGeometric(base, factor, steps) {
    if (steps <= 0) return 0;
    if (factor === 1 || factor === 1.0) return Math.floor(base * steps);
    let total = 0;
    for (let i = 0; i < steps; i++) total += Math.floor(base * Math.pow(factor, i));
    return total;
  }

  // Prefer the BUILD form (the one that actually contains the build button)
  function getFlags($ctx) {
    const $card = $ctx.closest('#technologydetails');
    let $form = $(); // will become the build form

    if ($card.length) {
      const $forms = $card.find('.build_form');
      // pick the one that has the build button inside
      $form = $forms.filter(function () {
        return $(this).find('.build-it_wrap .upgrade').length > 0;
      }).first();

      // fallback: if not found, use the last form in the card (usually the build form)
      if (!$form.length && $forms.length) $form = $forms.last();
    }

    // ultimate fallback if called with the form itself
    if (!$form.length && $ctx.is('.build_form')) $form = $ctx;

    // as a last resort, pick any global build form that has a button
    if (!$form.length) {
      $form = $('.build_form').filter(function () {
        return $(this).find('.build-it_wrap .upgrade').length > 0;
      }).first();
    }

    const attr = n => Number($form.data(n)) === 1;

    return {
      okTech:     attr('tech-ok'),
      okRoom:     attr('room-ok'),
      maxReached: attr('max-reached'),
      okBuyable:  attr('buyable'),
      isBusy:     attr('busy'),
      $form
    };
  }

  function ensureBadge($li) {
    let $b = $li.children('.lack-badge');
    if (!$b.length) {
      $b = $('<span class="lack-badge tooltipTop js_hideTipOnMobile" />').appendTo($li);
    }
    return $b;
  }

  // Update a single costs panel (if it exists)
  function updateCostsForPanel($panel) {
    if (!$panel || !$panel.length) return { hasInsufficient: false };

    const stock  = readStock();
    const factor = Number($panel.data('factor')) || 1;

    // steps resolution (input optional)
    const level  = Number($panel.data('level')) || 0;
    const max    = Number($panel.data('max')) || 255;
    let techId   = $panel.data('tech-id');

    let $input = techId ? $('#b_input_' + techId) : $();
    if (!$input.length) {
      $input = $panel.closest('#technologydetails').find('input.upgrade-input,[id^="b_input_"]').first();
    }
    let target = $input.length ? Number($input.val()) : (level + 1);
    if (!isFinite(target)) target = level + 1;
    target = Math.min(Math.max(target, level + 1), max);
    const steps = Math.max(0, target - level);

    // keep track if any deficit
    let hasInsufficient = false;

    $panel.find('li.cost-item').each(function () {
      const $li   = $(this);
      const resId = Number($li.data('res'));
      const base  = Number($li.data('base')) || 0;

      // strip legacy tooltip from row (avoid double tooltips)
      if ($li.attr('title')) $li.removeAttr('title');
      if ($li.hasClass('tooltipTop')) $li.removeClass('tooltipTop');

      const costTotal = sumGeometric(base, factor, steps);

      // update main amount (full pretty)
      $li.find('.res-amount, .amount').text(prettyFmt(costTotal));

      const haveAttr = $li.data('have');
      const stockMap = stock[resId] ?? 0;
      const have = (haveAttr !== undefined && haveAttr !== null && !isNaN(Number(haveAttr)))
        ? Number(haveAttr) : stockMap;

      const lack = costTotal - have;
      const lackVal = lack > 0 ? lack : 0;

      const $badge = ensureBadge($li);
      const $inlineLack = $li.children('.lack');

      if (lackVal > 0) {
        hasInsufficient = true;
        $li.addClass('insufficient');

        $badge.text('−' + shortFmt(lackVal))
              .attr('title', '−' + prettyFmt(lackVal))
              .removeAttr('hidden')
              .attr('aria-hidden', 'false')
              .css('display', 'inline-block');

        if ($inlineLack.length) {
          $inlineLack.text('−' + shortFmt(lackVal))
                     .attr('title', '−' + prettyFmt(lackVal))
                     .removeAttr('hidden')
                     .attr('aria-hidden', 'false')
                     .css('display', 'inline');
        }
      } else {
        $li.removeClass('insufficient');
        $badge.text('').attr('title','').attr('aria-hidden','true').attr('hidden',true).css('display','none');
        if ($inlineLack.length) {
          $inlineLack.text('').attr('title','').attr('aria-hidden','true').attr('hidden',true).css('display','none');
        }
      }
    });

    return { hasInsufficient };
  }

  // Toggle the button based on flags + deficits
  function toggleBuildButton($ctx, hasInsufficient) {
    const { okTech, okRoom, maxReached, okBuyable, isBusy, $form } = getFlags($ctx);
    if (!$form.length) return;

    // Find the actual build button robustly
    let $btn = $form.find('.build-it_wrap .upgrade').first();
    if (!$btn.length) {
      // fallback: sometimes markup nesting differs
      $btn = $form.closest('#technologydetails').find('.build-it_wrap .upgrade').first();
    }
    if (!$btn.length) return;

    let shouldDisable = false;
    let reason = '';

    if (!okTech) {
      shouldDisable = true; reason = (window.LNG?.bd_req_not_met || 'Requirements not met');
    } else if (!okRoom) {
      shouldDisable = true; reason = (window.LNG?.bd_no_more_fields || 'No more fields');
    } else if (maxReached) {
      shouldDisable = true; reason = (window.LNG?.bd_maxlevel || 'Max level reached');
    } else if (isBusy) {
      shouldDisable = true; reason = (window.LNG?.bd_working || 'Working…');
    } else if (!okBuyable || hasInsufficient) {
      shouldDisable = true; reason = (window.LNG?.bd_not_enough || window.LNG?.bd_remaining_res || 'Not enough resources');
    }

    const $label = $btn.find('.tooltipTop');

    if (shouldDisable) {
      $btn.prop('disabled', true).attr('disabled','disabled').addClass('is-disabled');
      if ($label.length) $label.attr('title', reason);
    } else {
      $btn.prop('disabled', false).removeAttr('disabled').removeClass('is-disabled');
      if ($label.length) $label.attr('title', (window.LNG?.bd_build || 'Build'));
    }
  }

  function updateAll() {
    // 1) Update all visible cost panels (with resource deficits)
    let any = false;
    $('.costs').each(function () {
      const res = updateCostsForPanel($(this));
      toggleBuildButton($(this), !!res.hasInsufficient);
      any = true;
    });

    // 2) Also handle forms that exist without a .costs panel (tech not available)
    $('.build_form').each(function () {
      const $form = $(this);
      const $panel = $form.closest('#technologydetails').find('.costs');
      if (!$panel.length) {
        toggleBuildButton($form, /*hasInsufficient*/ false);
      }
    });

    return any;
  }

  // ---------- boot ----------
  $(function () {
    const initial = updateAll();
    console.log('[buildlist.js] first pass panels:', initial ? 'found' : 'none');

    // Retry a few times for late DOM
    let tries = 0; const maxTries = 10;
    const timer = setInterval(function () {
      const any = updateAll();
      tries++;
      if (any || tries >= maxTries) clearInterval(timer);
    }, 300);

    // Observe DOM mutations
    if (window.MutationObserver) {
      const obs = new MutationObserver(function (mut) {
        let needs = false;
        for (const m of mut) {
          if (m.addedNodes && m.addedNodes.length) {
            for (const n of m.addedNodes) {
              if (!(n instanceof HTMLElement)) continue;
              if (n.matches('.costs, .build_form, [id^="b_input_"]') || n.querySelector?.('.costs,.build_form')) {
                needs = true; break;
              }
            }
          }
          if (needs) break;
        }
        if (needs) setTimeout(updateAll, 50);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // Recalculate on level input changes
    $(document).on('input change', '[id^="b_input_"], input.upgrade-input', function () {
      const $tech  = $(this).closest('#technologydetails');
      const $panel = $tech.find('.costs').first();
      const res = updateCostsForPanel($panel);
      toggleBuildButton($tech, !!(res && res.hasInsufficient));
    });
  });

})(window.jQuery, window, document);
